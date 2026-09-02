import { describe, it, expect } from 'vitest';
import { MaxLeverageRule } from '../../src/rules/MaxLeverageRule.js';
import { describeRuleContract } from './rule-contract.js';
import type { ProposedTrade } from '../../src/interfaces/TradeRule.js';

describe('MaxLeverageRule', () => {
  const validTrade: ProposedTrade = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.01,
    leverage: 3,
    market: 'FUTURES',
  };

  const invalidTrade: ProposedTrade = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.01,
    leverage: 10, // Exceeds max of 5
    market: 'FUTURES',
  };

  // Run the shared contract test suite
  describeRuleContract(
    'MaxLeverageRule',
    () => new MaxLeverageRule(5),
    validTrade,
    invalidTrade,
  );

  // Rule-specific tests
  it('passes for SPOT trades regardless of leverage field', async () => {
    const rule = new MaxLeverageRule(5);
    const spotTrade: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.01,
      market: 'SPOT',
      leverage: 100, // Irrelevant for spot
    };

    const result = await rule.evaluate(spotTrade, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(true);
  });

  it('treats missing leverage as 1x', async () => {
    const rule = new MaxLeverageRule(5);
    const trade: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.01,
      market: 'FUTURES',
      // leverage omitted
    };

    const result = await rule.evaluate(trade, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(true);
  });

  it('fails when leverage exactly exceeds max', async () => {
    const rule = new MaxLeverageRule(5);
    const trade: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.01,
      leverage: 5.01,
      market: 'FUTURES',
    };

    const result = await rule.evaluate(trade, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('5.01');
    expect(result.reason).toContain('5');
  });

  it('passes when leverage equals max', async () => {
    const rule = new MaxLeverageRule(5);
    const trade: ProposedTrade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.01,
      leverage: 5,
      market: 'FUTURES',
    };

    const result = await rule.evaluate(trade, {
      validationTimestamp: '2026-09-02T15:00:00Z',
    });

    expect(result.passed).toBe(true);
  });

  it('throws on invalid maxLeverage in constructor', () => {
    expect(() => new MaxLeverageRule(0)).toThrow();
    expect(() => new MaxLeverageRule(-1)).toThrow();
    expect(() => new MaxLeverageRule(Infinity)).toThrow();
    expect(() => new MaxLeverageRule(NaN)).toThrow();
  });
});
