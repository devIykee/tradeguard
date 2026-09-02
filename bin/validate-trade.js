#!/usr/bin/env node
/**
 * validate-trade.js — PreToolUse hook entry point for TradeGuard.
 *
 * ## What this does
 *
 * 1. Reads hook input from stdin (JSON: tool_name, tool_input, context)
 * 2. Loads risk rules config from /config/risk-rules.json
 * 3. Instantiates RuleEngine with MaxLeverageRule, MaxOrderSizeRule, PriceDeviationRule, SymbolWhitelistRule
 * 4. Evaluates the proposed trade
 * 5. Writes hookSpecificOutput to stdout (JSON: permissionDecision, permissionDecisionReason)
 * 6. Exits 0 (allow or deny) or 2 (hard block)
 *
 * ## Hook Contract (Claude Code PreToolUse)
 *
 * Input (stdin):
 * {
 *   "tool_name": "mcp__binance-mcp-server__place_order",
 *   "tool_input": { "symbol": "BTCUSDT", "side": "BUY", "quantity": 0.01, "leverage": 10, ... },
 *   "tool_use_id": "toolu_01...",
 *   "session_id": "...",
 *   "hook_event_name": "PreToolUse",
 *   "cwd": "/home/user/project",
 *   "permission_mode": "default"
 * }
 *
 * Output (stdout):
 * {
 *   "hookSpecificOutput": {
 *     "hookEventName": "PreToolUse",
 *     "permissionDecision": "deny",  // or "allow"
 *     "permissionDecisionReason": "Leverage 10x exceeds max allowed 5x"
 *   }
 * }
 *
 * Exit codes:
 * - 0: validation passed or failed normally (check JSON for permissionDecision)
 * - 2: hard block (overrides any JSON "allow")
 * - 1: script error (treated as non-blocking error by Claude Code)
 */

import { stdin, stdout, stderr } from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Import compiled JavaScript modules from dist/
const { RuleEngine } = await import(`${PROJECT_ROOT}/dist/rules/RuleEngine.js`);
const { MaxLeverageRule } = await import(`${PROJECT_ROOT}/dist/rules/MaxLeverageRule.js`);
const { MaxOrderSizeRule } = await import(`${PROJECT_ROOT}/dist/rules/MaxOrderSizeRule.js`);
const { PriceDeviationRule } = await import(`${PROJECT_ROOT}/dist/rules/PriceDeviationRule.js`);
const { SymbolWhitelistRule } = await import(`${PROJECT_ROOT}/dist/rules/SymbolWhitelistRule.js`);
const { loadRiskRulesConfig, DEFAULT_CONFIG_PATH } = await import(`${PROJECT_ROOT}/dist/config/risk-rules-loader.js`);

/**
 * Mock MarketDataSource for hook path — pulls live price via Binance public REST API.
 * (Not using BinanceMcpClient because that requires MCP connection; this is simpler for demo.)
 */
class SimpleBinanceMarketData {
  async getLivePrice(symbol) {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return parseFloat(data.price);
  }
}

/**
 * Read JSON from stdin.
 */
async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Main hook logic.
 */
async function main() {
  try {
    // Read hook input
    const inputText = await readStdin();
    const hookInput = JSON.parse(inputText);

    const { tool_name, tool_input, session_id, tool_use_id } = hookInput;

    // Only intercept Binance MCP server tools
    if (!tool_name || !tool_name.startsWith('mcp__binance-mcp-server__')) {
      // Not a Binance tool — allow
      stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        }
      }));
      return;
    }

    // Parse tool input into ProposedTrade
    const trade = {
      symbol: tool_input.symbol || 'UNKNOWN',
      side: tool_input.side || 'BUY',
      type: tool_input.type || 'MARKET',
      quantity: parseFloat(tool_input.quantity) || 0,
      price: tool_input.price ? parseFloat(tool_input.price) : undefined,
      stopPrice: tool_input.stopPrice ? parseFloat(tool_input.stopPrice) : undefined,
      leverage: tool_input.leverage ? parseFloat(tool_input.leverage) : undefined,
      market: tool_input.market || (tool_input.leverage ? 'FUTURES' : 'SPOT'),
      rawToolInput: tool_input,
    };

    const context = {
      validationTimestamp: new Date().toISOString(),
      sessionId: session_id,
      toolUseId: tool_use_id,
    };

    // Load config
    const configPath = resolve(PROJECT_ROOT, DEFAULT_CONFIG_PATH);
    const config = await loadRiskRulesConfig(configPath);

    // Instantiate market data source
    const marketData = new SimpleBinanceMarketData();

    // Build rules
    const rules = [
      new MaxLeverageRule(config.maxLeverage),
      new SymbolWhitelistRule(config.allowedSymbols),
      new MaxOrderSizeRule(config.maxOrderSizeUSDT, marketData),
      new PriceDeviationRule(config.maxPriceDeviationPct, marketData),
    ];

    // Evaluate
    const engine = new RuleEngine(rules);
    const result = await engine.evaluate(trade, context);

    // Write output
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.passed ? 'allow' : 'deny',
        permissionDecisionReason: result.reason || undefined,
      }
    };

    stdout.write(JSON.stringify(output, null, 2));

  } catch (error) {
    // Log error to stderr (goes to debug log, not transcript)
    stderr.write(`TradeGuard validation error: ${error.message}\n`);
    stderr.write(error.stack || '');
    stderr.write('\n');

    // Fail-safe: deny on error
    stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `TradeGuard validation failed: ${error.message}`,
      }
    }));

    process.exit(2); // Hard block on error
  }
}

main().catch(err => {
  stderr.write(`Uncaught error in TradeGuard hook: ${err.message}\n`);
  process.exit(2);
});
