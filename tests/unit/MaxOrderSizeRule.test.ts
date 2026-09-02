import { describe, it, expect } from 'vitest';
import { MaxOrderSizeRule } from '../../src/rules/MaxOrderSizeRule.js';
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

describe('MaxOrderSizeRule', () => {
  const mockMarket = new MockMarketDataSource({
    BTCUSDT: 50000.0, // BTC = $50k
    ETHUSDT: 2500.0, // ETH = $2.5k
  });

  const validTrade: ProposedTrade = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.01, // 0.01 BTC * $50k = $500 (under $1000 max)
    market: 'SPOT',
  };

  const invalidTrade: ProposedTrade = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.05, // 0.05 BTC * $50k = $2500 (over $1000 max)
    market: 'SPOT',
  };

  // Run the shared contract test suite
  describeRuleContract(
    'MaxOrderSizeRule',
    () => new MaxOrderSizeRule(1000, mockMarket),
    validTrade,
    invalidTrade,
  );

  // Rule-specific tests
  it('calculates notional correctly', async () => {
    const rule = new MaxOrderSizeRule(1000, mockMarket);

    // 0.02 BTC * $50k = $1000 exactly (should pass)
    const exactLimit: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.02,
      market: 'SPOT',
    };

    const result = await rule.evaluate(exactLimit, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(true);
  });

  it('fails when notional exceeds max by a tiny amount', async () => {
    const rule = new MaxOrderSizeRule(1000, mockMarket);

    // 0.0201 BTC * $50k = $1005 (over by $5)
    const slightlyOver: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.0201,
      market: 'SPOT',
    };

    const result = await rule.evaluate(slightlyOver, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('1005');
    expect(result.reason).toContain('1000');
  });

  it('works for different symbols with different prices', async () => {
    const rule = new MaxOrderSizeRule(1000, mockMarket);

    // 0.3 ETH * $2500 = $750 (under $1000)
    const ethTrade: ProposedTrade = {
      symbol: 'ETHUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.3,
      market: 'SPOT',
    };

    const result = await rule.evaluate(ethTrade, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(true);
  });

  it('includes price and quantity breakdown in denial reason', async () => {
    const rule = new MaxOrderSizeRule(1000, mockMarket);

    const result = await rule.evaluate(invalidTrade, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('2500'); // Notional
    expect(result.reason).toContain('1000'); // Max
    expect(result.reason).toContain('0.05'); // Quantity
    expect(result.reason).toContain('50000'); // Price
  });

  it('fails safe when market data unavailable', async () => {
    const rule = new MaxOrderSizeRule(1000, mockMarket);

    const unknownSymbol: ProposedTrade = {
      symbol: 'SOLUSDT', // Not in mock prices
      side: 'BUY',
      type: 'MARKET',
      quantity: 10,
      market: 'SPOT',
    };

    const result = await rule.evaluate(unknownSymbol, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('market data unavailable');
    expect(result.reason).toContain('SOLUSDT');
  });

  it('throws on invalid maxOrderSizeUSDT in constructor', () => {
    expect(() => new MaxOrderSizeRule(0, mockMarket)).toThrow();
    expect(() => new MaxOrderSizeRule(-100, mockMarket)).toThrow();
    expect(() => new MaxOrderSizeRule(Infinity, mockMarket)).toThrow();
    expect(() => new MaxOrderSizeRule(NaN, mockMarket)).toThrow();
  });
});
