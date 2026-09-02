import type { ProposedTrade } from './TradeRule.js';

/**
 * Executes trades (NOT USED in hook path, present for Open/Closed principle).
 *
 * ## Why this exists when TradeGuard doesn't execute trades
 *
 * In the PreToolUse hook path, trades execute via the original MCP call after
 * validation passes — TradeGuard never calls this interface.
 *
 * This interface exists to satisfy the **Open/Closed Principle**: adding a
 * future CLI demo harness that submits trades directly (bypassing the hook)
 * requires zero changes to RuleEngine or the rule implementations, just a new
 * caller that uses TradeExecutor after RuleEngine passes.
 *
 * ## Implementations
 *
 * - BinanceMcpClient: submits order via Binance MCP Trade scope (unused in hook path)
 * - MockTradeExecutor (tests): records submitted trades without executing
 */
export interface TradeResult {
  success: boolean;
  orderId?: string;
  executedQty?: number;
  executedPrice?: number;
  error?: string;
}

export interface TradeExecutor {
  /**
   * Submit a trade to the exchange.
   *
   * @param trade The trade to execute
   * @returns Result indicating success/failure and execution details
   */
  submitTrade(trade: ProposedTrade): Promise<TradeResult>;
}

// Re-export ProposedTrade so TradeExecutor consumers don't need two imports
export type { ProposedTrade };
