import type { MarketDataSource } from '../interfaces/MarketDataSource.js';
import type { AccountReader, Balance } from '../interfaces/AccountReader.js';
import type { TradeExecutor, TradeResult, ProposedTrade } from '../interfaces/index.js';

/**
 * BinanceMcpClient: typed wrapper around Binance MCP server tool calls.
 *
 * ## Purpose
 *
 * Translates method calls like `getLivePrice(symbol)` into MCP tool invocations
 * and back. Contains zero rule logic — doesn't know what "leverage" means as a
 * risk concept, only that it's a field passed through.
 *
 * ## Implementation Note
 *
 * In the PreToolUse hook path, this client is NOT directly used for validation
 * (rules receive mocked implementations in tests). However, it's here to satisfy
 * the Open/Closed Principle: a future CLI demo harness can use this to pull live
 * market data or submit trades directly.
 *
 * For the hook path, market data is pulled by calling the Binance MCP server's
 * market data tools directly from the hook script, bypassing this client.
 *
 * ## MCP Tool Naming (UNCONFIRMED)
 *
 * Actual tool names are unknown until the user connects binance-mcp-server and
 * inspects via /mcp menu. Assumed naming: `mcp__binance-mcp-server__<tool>`.
 *
 * This client is a placeholder for now — real implementation requires:
 * 1. User runs: `claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic`
 * 2. Authenticate via browser OAuth flow
 * 3. Inspect tool names via `/mcp` menu in Claude Code
 * 4. Update this client with actual tool names and schemas
 *
 * ## Dependencies
 *
 * None — this is a pure translation layer. It doesn't import from /src/rules or /src/hook.
 */

/**
 * Placeholder implementation — returns mock data until real MCP connection is established.
 *
 * TODO: Replace with real MCP client once tool names are confirmed.
 */
export class BinanceMcpClient implements MarketDataSource, AccountReader, TradeExecutor {
  /**
   * Get live price for a symbol via Binance MCP Market Data scope.
   *
   * Assumed tool: `mcp__binance-mcp-server__get_ticker_price` or similar.
   * Real implementation will call MCP tool and extract `lastPrice` from response.
   */
  async getLivePrice(_symbol: string): Promise<number> {
    // TODO: Replace with real MCP call
    // const result = await callMcpTool('mcp__binance-mcp-server__get_ticker_price', { symbol: _symbol });
    // return result.lastPrice;

    throw new Error(
      `BinanceMcpClient.getLivePrice() not implemented — real MCP tool names unknown. ` +
      `Connect binance-mcp-server first: claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic`
    );
  }

  /**
   * Get 24-hour price change percentage for a symbol.
   *
   * Assumed tool: same as getLivePrice, extract `priceChangePercent` from ticker.
   */
  async get24hChange(_symbol: string): Promise<number> {
    // TODO: Replace with real MCP call
    throw new Error(
      `BinanceMcpClient.get24hChange() not implemented — real MCP tool names unknown.`
    );
  }

  /**
   * Get account balance via Binance MCP Account scope.
   *
   * Assumed tool: `mcp__binance-mcp-server__get_account_balance` or similar.
   */
  async getBalance(): Promise<Balance> {
    // TODO: Replace with real MCP call
    throw new Error(
      `BinanceMcpClient.getBalance() not implemented — real MCP tool names unknown.`
    );
  }

  /**
   * Submit a trade via Binance MCP Trade scope.
   *
   * Assumed tool: `mcp__binance-mcp-server__place_order` or similar.
   *
   * NOTE: In the PreToolUse hook path, this method is NEVER called — trades
   * execute via the original MCP call after validation passes. This exists
   * for Open/Closed: a future CLI demo harness could submit trades directly.
   */
  async submitTrade(_trade: ProposedTrade): Promise<TradeResult> {
    // TODO: Replace with real MCP call
    throw new Error(
      `BinanceMcpClient.submitTrade() not implemented — not used in hook path, ` +
      `but present for Open/Closed principle.`
    );
  }
}
