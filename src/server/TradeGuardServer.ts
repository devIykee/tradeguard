import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { RuleEngine } from '../rules/RuleEngine.js';
import { MaxLeverageRule } from '../rules/MaxLeverageRule.js';
import { MaxOrderSizeRule } from '../rules/MaxOrderSizeRule.js';
import { PriceDeviationRule } from '../rules/PriceDeviationRule.js';
import { SymbolWhitelistRule } from '../rules/SymbolWhitelistRule.js';
import { BinanceMcpHttpClient } from '../binance/BinanceMcpHttpClient.js';
import { loadRiskRulesConfig } from '../config/risk-rules-loader.js';
import type { ProposedTrade } from '../interfaces/TradeRule.js';

/**
 * TradeGuardServer: MCP proxy server that validates trades before forwarding to Binance.
 *
 * Architecture:
 *   Agent → TradeGuardServer (validates) → Binance MCP (executes)
 *
 * This makes TradeGuard agent-agnostic — works with Claude Code, OpenClaw,
 * or any MCP-compatible agent, not just Claude Code's PreToolUse hook.
 *
 * Usage:
 *   BINANCE_TOKEN=your_token node bin/start-server.js
 *
 * Agent connects to TradeGuard instead of Binance directly:
 *   claude mcp add tradeguard sse node /path/to/tradeguard/bin/start-server.js
 */
export class TradeGuardServer {
  private server: Server;
  private binanceClient: BinanceMcpHttpClient;
  private ruleEngine: RuleEngine;

  constructor(binanceToken: string, configPath: string) {
    this.server = new Server(
      {
        name: 'tradeguard',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.binanceClient = new BinanceMcpHttpClient(binanceToken);
    this.ruleEngine = new RuleEngine([]); // Initialized in start()

    this.setupHandlers(configPath);
  }

  private setupHandlers(_configPath: string) {
    // List tools: forward from Binance MCP server
    this.server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => {
      const { tools } = await this.binanceClient.listTools();
      return { tools };
    });

    // Call tool: VALIDATE then forward to Binance
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      // Only validate trade-related tools (order, place_order, create_order, etc.)
      const isTradeTool = /order|trade|buy|sell/i.test(name);

      if (isTradeTool) {
        // Parse trade from tool arguments
        const trade = this.parseTradeFromArgs(args ?? {});

        // Validate with RuleEngine
        const result = await this.ruleEngine.evaluate(trade, {
          validationTimestamp: new Date().toISOString(),
        });

        if (!result.passed) {
          // Blocked by TradeGuard
          return {
            content: [
              {
                type: 'text',
                text: `❌ TradeGuard blocked this trade:\n\n${result.reason}\n\nRule: ${result.ruleName}`,
              },
            ],
            isError: true,
          };
        }
      }

      // Passed validation (or not a trade tool) → forward to Binance
      try {
        const binanceResult = await this.binanceClient.callTool(name, args ?? {});
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(binanceResult, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Binance error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Parse ProposedTrade from MCP tool arguments.
   * Tool schemas vary, so we extract fields defensively.
   */
  private parseTradeFromArgs(args: Record<string, unknown>): ProposedTrade {
    const symbol = String(args['symbol'] ?? args['pair'] ?? '').toUpperCase();
    const side = String(args['side'] ?? 'BUY').toUpperCase() as 'BUY' | 'SELL';
    const type = String(args['type'] ?? args['orderType'] ?? 'MARKET').toUpperCase() as ProposedTrade['type'];
    const quantity = parseFloat(String(args['quantity'] ?? args['amount'] ?? 0));
    const price = args['price'] !== undefined ? parseFloat(String(args['price'])) : undefined;
    const stopPrice = args['stopPrice'] !== undefined ? parseFloat(String(args['stopPrice'])) : undefined;
    const leverage = args['leverage'] !== undefined ? parseFloat(String(args['leverage'])) : undefined;

    // Detect market type from symbol suffix or explicit field
    let market: 'SPOT' | 'FUTURES' = 'SPOT';
    if (args['market']) {
      market = String(args['market']).toUpperCase().includes('FUTURE') ? 'FUTURES' : 'SPOT';
    } else if (leverage !== undefined && leverage > 1) {
      market = 'FUTURES';
    }

    return {
      symbol,
      side,
      type,
      quantity,
      price,
      stopPrice,
      leverage,
      market,
      rawToolInput: args,
    };
  }

  async start(configPath: string) {
    // Load config and initialize RuleEngine
    const config = await loadRiskRulesConfig(configPath);

    const rules = [
      new MaxLeverageRule(config.maxLeverage),
      new SymbolWhitelistRule(config.allowedSymbols),
      new MaxOrderSizeRule(config.maxOrderSizeUSDT, this.binanceClient),
      new PriceDeviationRule(config.maxPriceDeviationPct, this.binanceClient),
    ];

    this.ruleEngine = new RuleEngine(rules);

    // Start MCP server on stdio
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('TradeGuard MCP Server running on stdio');
    console.error(`Loaded ${rules.length} rules from ${configPath}`);
    console.error('Ready to validate Binance trades');
  }
}
