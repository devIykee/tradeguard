import { describe, it, expect } from 'vitest';
import { SymbolWhitelistRule } from '../../src/rules/SymbolWhitelistRule.js';
import { describeRuleContract } from './rule-contract.js';
import type { ProposedTrade } from '../../src/interfaces/TradeRule.js';

describe('SymbolWhitelistRule', () => {
  const validTrade: ProposedTrade = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.01,
    market: 'SPOT',
  };

  const invalidTrade: ProposedTrade = {
    symbol: 'DOGEUSDT', // Not in whitelist
    side: 'BUY',
    type: 'MARKET',
    quantity: 100,
    market: 'SPOT',
  };

  // Run the shared contract test suite
  describeRuleContract(
    'SymbolWhitelistRule',
    () => new SymbolWhitelistRule(['BTCUSDT', 'ETHUSDT', 'BNBUSDT']),
    validTrade,
    invalidTrade,
  );

  // Rule-specific tests
  it('is case-insensitive', async () => {
    const rule = new SymbolWhitelistRule(['BTCUSDT', 'ETHUSDT']);

    const lowercase: ProposedTrade = { ...validTrade, symbol: 'btcusdt' };
    const mixedCase: ProposedTrade = { ...validTrade, symbol: 'BtcUsDt' };
    const uppercase: ProposedTrade = { ...validTrade, symbol: 'BTCUSDT' };

    const result1 = await rule.evaluate(lowercase, { validationTimestamp: '2026-09-02T15:00:00Z' });
    const result2 = await rule.evaluate(mixedCase, { validationTimestamp: '2026-09-02T15:00:00Z' });
    const result3 = await rule.evaluate(uppercase, { validationTimestamp: '2026-09-02T15:00:00Z' });

    expect(result1.passed).toBe(true);
    expect(result2.passed).toBe(true);
    expect(result3.passed).toBe(true);
  });

  it('includes allowed list in denial reason', async () => {
    const rule = new SymbolWhitelistRule(['BTCUSDT', 'ETHUSDT']);
    const trade: ProposedTrade = { ...validTrade, symbol: 'SOLUSDT' };

    const result = await rule.evaluate(trade, { validationTimestamp: '2026-09-02T15:00:00Z' });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('SOLUSDT');
    expect(result.reason).toContain('btcusdt'); // Lowercase in output
    expect(result.reason).toContain('ethusdt');
  });

  it('passes for all symbols in whitelist', async () => {
    const rule = new SymbolWhitelistRule(['BTCUSDT', 'ETHUSDT', 'BNBUSDT']);

    for (const symbol of ['BTCUSDT', 'ETHUSDT', 'BNBUSDT']) {
      const trade: ProposedTrade = { ...validTrade, symbol };
      const result = await rule.evaluate(trade, { validationTimestamp: '2026-09-02T15:00:00Z' });
      expect(result.passed).toBe(true);
    }
  });

  it('fails for symbols not in whitelist', async () => {
    const rule = new SymbolWhitelistRule(['BTCUSDT']);

    for (const symbol of ['ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT', 'BTCUSD']) {
      const trade: ProposedTrade = { ...validTrade, symbol };
      const result = await rule.evaluate(trade, { validationTimestamp: '2026-09-02T15:00:00Z' });
      expect(result.passed).toBe(false);
      expect(result.reason).toContain(symbol);
    }
  });

  it('throws on empty whitelist', () => {
    expect(() => new SymbolWhitelistRule([])).toThrow();
  });

  it('exposes allowed symbols via getAllowedSymbols()', () => {
    const rule = new SymbolWhitelistRule(['BTCUSDT', 'ETHUSDT']);
    const allowed = rule.getAllowedSymbols();

    expect(allowed).toContain('btcusdt'); // Normalized to lowercase
    expect(allowed).toContain('ethusdt');
    expect(allowed.length).toBe(2);
  });
});
