import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../src/rules/RuleEngine.js';
import type { TradeRule, ProposedTrade, RuleContext, ValidationResult } from '../../src/interfaces/TradeRule.js';

/**
 * Fake rule that always passes — used to prove RuleEngine treats all rules identically.
 */
class AlwaysPassRule implements TradeRule {
  readonly name = 'always-pass';

  async evaluate(_trade: ProposedTrade, _context: RuleContext): Promise<ValidationResult> {
    return { passed: true, ruleName: this.name };
  }
}

/**
 * Fake rule that always fails — used to prove RuleEngine short-circuits on first failure.
 */
class AlwaysFailRule implements TradeRule {
  readonly name = 'always-fail';

  async evaluate(_trade: ProposedTrade, _context: RuleContext): Promise<ValidationResult> {
    return {
      passed: false,
      ruleName: this.name,
      reason: 'Always fails for testing',
    };
  }
}

describe('RuleEngine', () => {
  const mockTrade: ProposedTrade = {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.01,
    market: 'SPOT',
  };

  const mockContext: RuleContext = {
    validationTimestamp: '2026-09-02T15:00:00Z',
  };

  it('returns passed=true when all rules pass', async () => {
    const engine = new RuleEngine([new AlwaysPassRule(), new AlwaysPassRule()]);
    const result = await engine.evaluate(mockTrade, mockContext);

    expect(result.passed).toBe(true);
    expect(result.ruleName).toBe('all-rules');
  });

  it('returns passed=false on first failing rule', async () => {
    const engine = new RuleEngine([new AlwaysPassRule(), new AlwaysFailRule()]);
    const result = await engine.evaluate(mockTrade, mockContext);

    expect(result.passed).toBe(false);
    expect(result.ruleName).toBe('always-fail');
    expect(result.reason).toBe('Always fails for testing');
  });

  it('short-circuits on first failure — later rules do not run', async () => {
    let secondRuleCalled = false;

    class FirstFailsRule implements TradeRule {
      readonly name = 'first-fails';
      async evaluate(): Promise<ValidationResult> {
        return { passed: false, ruleName: this.name, reason: 'First rule failed' };
      }
    }

    class SecondRule implements TradeRule {
      readonly name = 'second';
      async evaluate(): Promise<ValidationResult> {
        secondRuleCalled = true;
        return { passed: true, ruleName: this.name };
      }
    }

    const engine = new RuleEngine([new FirstFailsRule(), new SecondRule()]);
    const result = await engine.evaluate(mockTrade, mockContext);

    expect(result.passed).toBe(false);
    expect(result.ruleName).toBe('first-fails');
    expect(secondRuleCalled).toBe(false); // Second rule never ran
  });

  it('returns passed=true for empty rule list', async () => {
    const engine = new RuleEngine([]);
    const result = await engine.evaluate(mockTrade, mockContext);

    expect(result.passed).toBe(true);
  });

  it('treats all TradeRule implementations identically (Liskov)', async () => {
    // Two different rule implementations, but RuleEngine doesn't special-case either
    const engine = new RuleEngine([new AlwaysPassRule(), new AlwaysFailRule()]);
    const result = await engine.evaluate(mockTrade, mockContext);

    // First rule passed, second failed — engine stopped at second
    expect(result.passed).toBe(false);
    expect(result.ruleName).toBe('always-fail');
  });

  it('exposes registered rules via getRules()', () => {
    const rules = [new AlwaysPassRule(), new AlwaysFailRule()];
    const engine = new RuleEngine(rules);

    expect(engine.getRules()).toEqual(rules);
  });
});
