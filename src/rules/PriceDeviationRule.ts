import type { TradeRule, ProposedTrade, RuleContext, ValidationResult } from '../interfaces/TradeRule.js';
import type { MarketDataSource } from '../interfaces/MarketDataSource.js';

/**
 * PriceDeviationRule: blocks trades with prices deviating significantly from live market.
 *
 * ## Why this matters — THE DIFFERENTIATOR
 *
 * This is TradeGuard's primary defensible angle. It catches **the agent's own
 * stale or hallucinated prices** before they reach execution.
 *
 * If Claude's reasoning references "current BTCUSDT is $95,000" (from cached
 * context, a stale web search, or outright hallucination) but live market shows
 * $68,000, this rule blocks the trade.
 *
 * Neither acevod/trading-guardian (advisory Skill) nor tokyoville741/guardrail-desk
 * (basic Python script) implements this check. eikarna/binance-agent-mcp has a
 * price-collar rule but measures slippage (order price vs bid/ask spread), not
 * deviation from live mid-market — different failure mode.
 *
 * ## How it works
 *
 * 1. Extract proposed price from trade:
 *    - LIMIT orders: `trade.price`
 *    - STOP_LIMIT orders: `trade.stopPrice` and `trade.price`
 *    - STOP orders: `trade.stopPrice`
 *    - MARKET orders: no proposed price to check, always pass (execution at market)
 *
 * 2. Fetch live price via `MarketDataSource.getLivePrice(symbol)` (Binance ticker lastPrice)
 *
 * 3. Calculate deviation: `abs((proposedPrice - livePrice) / livePrice) * 100`
 *
 * 4. Compare against `maxPriceDeviationPct` threshold (default: 2.0%)
 *
 * ## Rationale for 2.0% threshold
 *
 * BTCUSDT and ETHUSDT 1-minute ATR typically runs 0.3–0.8% in normal conditions,
 * spiking to 1.5–2.5% during volatile sessions. A 2% threshold:
 * - Allows normal intraday volatility (agent proposes 1% above mid → passes)
 * - Blocks stale prices from context cached >15 minutes during a 3% move → denied
 * - Blocks outright hallucinations (agent invents price 10% off market) → denied
 *
 * ## Edge case — rapid price movement
 *
 * If live price moves 2.5% *during* the validation window (200ms), this may
 * false-positive. Mitigation: accept this as a feature — if the market is moving
 * that fast, pausing for human review is correct behavior.
 *
 * ## Failure modes this defends against
 *
 * 1. Context caching: agent's last market data is 20 minutes old
 * 2. Hallucination: agent fabricates a plausible-sounding price
 * 3. Unit confusion: agent quotes price in wrong denomination (satoshis vs BTC)
 * 4. Typo in agent's reasoning: reads $68,234 as $86,234 in prior tool result
 *
 * ## Dependencies
 *
 * - MarketDataSource: pulls live price for deviation calculation
 */
export class PriceDeviationRule implements TradeRule {
  readonly name = 'price-deviation';

  constructor(
    private readonly maxDeviationPct: number,
    private readonly marketData: MarketDataSource,
  ) {
    if (maxDeviationPct <= 0 || !Number.isFinite(maxDeviationPct)) {
      throw new Error(`maxDeviationPct must be a positive finite number, got ${maxDeviationPct}`);
    }
  }

  async evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult> {
    // Extract proposed price(s) based on order type
    const proposedPrices: number[] = [];

    if (trade.type === 'LIMIT' || trade.type === 'STOP_LIMIT') {
      if (trade.price !== undefined) {
        proposedPrices.push(trade.price);
      }
    }

    if (trade.type === 'STOP' || trade.type === 'STOP_LIMIT') {
      if (trade.stopPrice !== undefined) {
        proposedPrices.push(trade.stopPrice);
      }
    }

    // MARKET orders have no proposed price — always pass
    if (proposedPrices.length === 0) {
      return { passed: true, ruleName: this.name };
    }

    // Fetch live price
    let livePrice: number;
    try {
      livePrice = await this.marketData.getLivePrice(trade.symbol);
    } catch (error) {
      // Market data unavailable — fail safe and deny
      return {
        passed: false,
        ruleName: this.name,
        reason: `Cannot verify price deviation: market data unavailable for ${trade.symbol} (${error instanceof Error ? error.message : String(error)})`,
      };
    }

    // Check each proposed price
    for (const proposedPrice of proposedPrices) {
      const deviationPct = Math.abs((proposedPrice - livePrice) / livePrice) * 100;

      if (deviationPct > this.maxDeviationPct) {
        return {
          passed: false,
          ruleName: this.name,
          reason: `Proposed price $${proposedPrice.toFixed(2)} deviates ${deviationPct.toFixed(2)}% from live market $${livePrice.toFixed(2)} (max allowed ${this.maxDeviationPct.toFixed(1)}%). Live price fetched at ${context.validationTimestamp}. If market moved, retry with current price.`,
        };
      }
    }

    return { passed: true, ruleName: this.name };
  }
}
