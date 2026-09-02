import { describe, it, expect } from 'vitest';
import { PriceDeviationRule } from '../../src/rules/PriceDeviationRule.js';
import { describeRuleContract } from './rule-contract.js';
import type { ProposedTrade } from '../../src/interfaces/TradeRule.js';
import type { MarketDataSource } from '../../src/interfaces/MarketDataSource.js';

/**
 * Mock MarketDataSource that returns hardcoded prices.
 */
class MockMarketDataSource implements MarketDataSource {
  constructor(private readonly prices: Record<string, number>) {}

  async getLivePrice(symbol: string): Promise<number> {
    const price = this.prices[symbol];
    if (price === undefined) {
      throw new Error(`No price data for ${symbol}`);
    }
    return price;
  }
}

describe('PriceDeviationRule', () => {
  const mockMarket = new MockMarketDataSource({
    BTCUSDT: 50000.0, // BTC = $50k
    ETHUSDT: 2500.0, // ETH = $2.5k
  });

  const context = { validationTimestamp: '2026-09-02T15:00:00Z' };

  // Valid: limit order 1% above live price (under 2% threshold)
  const validTrade: ProposedTrade = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 0.01,
    price: 50500, // $50k live, $50.5k proposed = 1% deviation
    market: 'SPOT',
  };

  // Invalid: limit order 5% above live price (over 2% threshold)
  const invalidTrade: ProposedTrade = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 0.01,
    price: 52500, // $50k live, $52.5k proposed = 5% deviation
    market: 'SPOT',
  };

  // Run the shared contract test suite
  describeRuleContract(
    'PriceDeviationRule',
    () => new PriceDeviationRule(2.0, mockMarket),
    validTrade,
    invalidTrade,
  );

  // Rule-specific tests
  it('passes for MARKET orders (no proposed price)', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    const marketOrder: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.01,
      market: 'SPOT',
      // No price or stopPrice
    };

    const result = await rule.evaluate(marketOrder, context);
    expect(result.passed).toBe(true);
  });

  it('checks price field for LIMIT orders', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    // Exactly 2% deviation (should pass)
    const exactLimit: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.01,
      price: 51000, // 2% above $50k
      market: 'SPOT',
    };

    const result = await rule.evaluate(exactLimit, context);
    expect(result.passed).toBe(true);
  });

  it('checks stopPrice field for STOP orders', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    // Stop price 5% below live (over 2% threshold)
    const stopOrder: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'STOP',
      quantity: 0.01,
      stopPrice: 47500, // 5% below $50k
      market: 'FUTURES',
    };

    const result = await rule.evaluate(stopOrder, context);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('47500');
    expect(result.reason).toContain('5.00%');
  });

  it('checks both price and stopPrice for STOP_LIMIT orders', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    // stopPrice OK (1% deviation), price BAD (5% deviation)
    const stopLimitOrder: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'STOP_LIMIT',
      quantity: 0.01,
      stopPrice: 50500, // 1% above
      price: 52500, // 5% above — should fail here
      market: 'FUTURES',
    };

    const result = await rule.evaluate(stopLimitOrder, context);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('52500');
  });

  it('checks deviation in both directions (above and below)', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    // 3% below live price
    const below: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.01,
      price: 48500, // 3% below $50k
      market: 'SPOT',
    };

    // 3% above live price
    const above: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.01,
      price: 51500, // 3% above $50k
      market: 'SPOT',
    };

    const resultBelow = await rule.evaluate(below, context);
    const resultAbove = await rule.evaluate(above, context);

    expect(resultBelow.passed).toBe(false);
    expect(resultAbove.passed).toBe(false);
  });

  it('includes timestamp in denial reason', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    const result = await rule.evaluate(invalidTrade, context);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('2026-09-02T15:00:00Z');
  });

  it('includes helpful context in denial reason', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    const result = await rule.evaluate(invalidTrade, context);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('52500'); // Proposed price
    expect(result.reason).toContain('50000'); // Live price
    expect(result.reason).toContain('5.00%'); // Deviation
    expect(result.reason).toContain('2.0%'); // Max allowed
    expect(result.reason).toContain('If market moved, retry'); // Actionable hint
  });

  it('works for different symbols with different prices', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    // ETH live = $2500, proposed = $2600 (4% deviation)
    const ethTrade: ProposedTrade = {
      symbol: 'ETHUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1.0,
      price: 2600,
      market: 'SPOT',
    };

    const result = await rule.evaluate(ethTrade, context);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('4.00%');
  });

  it('fails safe when market data unavailable', async () => {
    const rule = new PriceDeviationRule(2.0, mockMarket);

    const unknownSymbol: ProposedTrade = {
      symbol: 'SOLUSDT', // Not in mock prices
      side: 'BUY',
      type: 'LIMIT',
      quantity: 10,
      price: 100,
      market: 'SPOT',
    };

    const result = await rule.evaluate(unknownSymbol, context);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('market data unavailable');
    expect(result.reason).toContain('SOLUSDT');
  });

  it('throws on invalid maxDeviationPct in constructor', () => {
    expect(() => new PriceDeviationRule(0, mockMarket)).toThrow();
    expect(() => new PriceDeviationRule(-1, mockMarket)).toThrow();
    expect(() => new PriceDeviationRule(Infinity, mockMarket)).toThrow();
    expect(() => new PriceDeviationRule(NaN, mockMarket)).toThrow();
  });
});
