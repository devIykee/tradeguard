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
 * Strip the MCP prefix and unwrap `tool_execute`.
 *
 * The Binance MCP server exposes ~50 tools directly via tools/list and keeps the
 * rest hidden behind `tool_execute`, which carries the real target in
 * `arguments.toolName` and that tool's params in `arguments.arguments`. Order
 * placement lives behind the wrapper, so a hook that only reads top-level
 * tool_input sees no symbol at all.
 *
 * @returns {{ binanceTool: string, args: Record<string, unknown> }}
 */
function unwrapBinanceCall(toolName, toolInput) {
  const bare = toolName.replace(/^mcp__binance-mcp-server__/, '');
  const input = toolInput ?? {};

  if (bare === 'tool_execute' && typeof input.toolName === 'string') {
    return {
      binanceTool: input.toolName,
      args: (input.arguments && typeof input.arguments === 'object') ? input.arguments : {},
    };
  }

  return { binanceTool: bare, args: input };
}

/**
 * Does this Binance tool place a new order?
 *
 * Deliberately an allowlist of prefixes rather than a keyword match. `order` as a
 * substring also appears in queryOrder, allOrders, deleteOrder, getOpenOrders and
 * dozens of other read/cancel tools — matching on it treats every lookup as a
 * trade proposal.
 */
function isOrderPlacement(binanceTool) {
  const ORDER_PLACING = [
    'spot.newOrder',
    'spot.sorOrder',
    'spot.orderOco',
    'spot.orderList',        // orderListOco / Oto / Otoco / Opo / Opoco
    'spot.orderCancelReplace',
    'margin.marginAccountNewOrder',
    'margin.marginAccountNewOco',
    'margin.marginAccountNewOto',
    'futures_usds.newOrder',
    'futures_usds.placeMultipleOrders',
    'futures_usds.modifyOrder',
    'futures_coin.newOrder',
    'futures_coin.placeMultipleOrders',
    'futures_coin.modifyOrder',
  ];

  // orderTest / sorOrderTest validate without placing — nothing to gate.
  if (/orderTest$/i.test(binanceTool)) return false;

  return ORDER_PLACING.some(p => binanceTool === p || binanceTool.startsWith(p));
}

/**
 * Build a ProposedTrade from a Binance order tool's arguments.
 *
 * Binance splits leverage out of the order call: leverage is set separately via
 * changeInitialLeverage, so a futures newOrder carries no leverage field. Market
 * is therefore derived from the tool namespace, not from the presence of leverage.
 */
function parseTrade(binanceTool, args) {
  const num = (v) => (v === undefined || v === null || v === '') ? undefined : parseFloat(String(v));

  const isFutures = binanceTool.startsWith('futures_');
  const isMargin = binanceTool.startsWith('margin.');

  // quoteOrderQty means "spend N USDT" instead of "buy N BTC". Left as 0 here so
  // MaxOrderSizeRule doesn't multiply a quote amount by price and overstate the
  // notional by ~5 orders of magnitude; the quote value is passed through raw.
  const quantity = num(args.quantity) ?? 0;

  return {
    symbol: String(args.symbol ?? args.pair ?? '').toUpperCase(),
    side: String(args.side ?? 'BUY').toUpperCase(),
    type: String(args.type ?? 'MARKET').toUpperCase(),
    quantity,
    price: num(args.price),
    stopPrice: num(args.stopPrice),
    leverage: num(args.leverage),
    market: isFutures ? 'FUTURES' : (isMargin ? 'MARGIN' : 'SPOT'),
    rawToolInput: args,
  };
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

    const allow = (reason) => {
      stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          ...(reason ? { permissionDecisionReason: reason } : {}),
        }
      }));
    };

    // Only intercept Binance MCP server tools
    if (!tool_name || !tool_name.startsWith('mcp__binance-mcp-server__')) {
      allow();
      return;
    }

    // Unwrap tool_execute: the Binance MCP server exposes ~50 tools directly and
    // keeps the rest hidden behind a wrapper, where the real target is in
    // arguments.toolName and its params in arguments.arguments.
    const { binanceTool, args } = unwrapBinanceCall(tool_name, tool_input);

    // Only order-placing calls are trades. Everything else — market data, balances,
    // order lookups, cancels, tool_search — passes straight through. Validating them
    // as trades is what made every call fail with an empty-symbol whitelist error.
    if (!isOrderPlacement(binanceTool)) {
      allow();
      return;
    }

    // Parse tool input into ProposedTrade
    const trade = parseTrade(binanceTool, args);

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
