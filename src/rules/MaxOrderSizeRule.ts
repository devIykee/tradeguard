import type { TradeRule, ProposedTrade, RuleContext, ValidationResult } from '../interfaces/TradeRule.js';
import type { MarketDataSource } from '../interfaces/MarketDataSource.js';

/**
 * MaxOrderSizeRule: blocks trades exceeding a configured notional size in USDT.
 *
 * ## Why this matters
 *
 * Limits position size to prevent a single trade from dominating the portfolio.
 * A $5,000 account shouldn't allow a $3,000 order on one symbol — that's 60%
 * concentration in a single trade.
 *
 * ## How it works
 *
 * 1. Reads `trade.quantity` (in base asset, e.g., 0.1 BTC for BTCUSDT)
 * 2. Fetches live price via `MarketDataSource.getLivePrice(symbol)`
 * 3. Calculates notional: `quantity * livePrice` (in USDT)
 * 4. Compares against `maxOrderSizeUSDT` threshold
 *
 * ## Future enhancement (not implemented in core tier)
 *
 * Check `quantity * livePrice / accountEquity` to enforce a % of equity cap.
 * Requires injecting `AccountReader` and adding a `maxOrderSizePctEquity` config.
 *
 * ## Dependencies
 *
 * - MarketDataSource: pulls live price for notional calculation
 */
export class MaxOrderSizeRule implements TradeRule {
  readonly name = 'max-order-size';

  constructor(
    private readonly maxOrderSizeUSDT: number,
    private readonly marketData: MarketDataSource,
  ) {
    if (maxOrderSizeUSDT <= 0 || !Number.isFinite(maxOrderSizeUSDT)) {
      throw new Error(`maxOrderSizeUSDT must be a positive finite number, got ${maxOrderSizeUSDT}`);
    }
  }

  async evaluate(trade: ProposedTrade, _context: RuleContext): Promise<ValidationResult> {
    // Fetch live price to convert quantity → notional USDT
    let livePrice: number;
    try {
      livePrice = await this.marketData.getLivePrice(trade.symbol);
    } catch (error) {
      // Market data unavailable — fail safe and deny the trade
      return {
        passed: false,
        ruleName: this.name,
        reason: `Cannot verify order size: market data unavailable for ${trade.symbol} (${error instanceof Error ? error.message : String(error)})`,
      };
    }

    const notionalUSDT = trade.quantity * livePrice;

    if (notionalUSDT > this.maxOrderSizeUSDT) {
      return {
        passed: false,
        ruleName: this.name,
        reason: `Order size ${notionalUSDT.toFixed(2)} USDT exceeds max allowed ${this.maxOrderSizeUSDT.toFixed(2)} USDT (${trade.quantity} ${trade.symbol.replace('USDT', '')} @ $${livePrice.toFixed(2)})`,
      };
    }

    return { passed: true, ruleName: this.name };
  }
}
