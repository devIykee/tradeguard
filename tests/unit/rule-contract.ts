import { describe, it, expect } from 'vitest';
import type { TradeRule, ProposedTrade, RuleContext, ValidationResult } from '../../src/interfaces/TradeRule.js';

/**
 * The shared TradeRule contract test suite.
 *
 * This is the Liskov guarantee made executable: every TradeRule implementation
 * must be substitutable for any other inside RuleEngine, which iterates them
 * blindly. Each rule implementation calls this suite, so a new rule cannot
 * quietly break an invariant the engine relies on.
 *
 * Mirrored from AddressGuard's strategy-contract.ts pattern.
 *
 * @param name Rule name for test output
 * @param makeRule Factory that creates a fresh rule instance per test
 * @param validTrade A trade that should pass this rule
 * @param invalidTrade A trade that should fail this rule
 */
export function describeRuleContract(
  name: string,
  makeRule: () => TradeRule,
  validTrade: ProposedTrade,
  invalidTrade: ProposedTrade,
): void {
  describe(`${name} — TradeRule contract`, () => {
    const context: RuleContext = {
      validationTimestamp: '2026-09-02T15:00:00Z',
      sessionId: 'test-session',
      toolUseId: 'test-tool-use',
    };

    it('returns a ValidationResult with passed boolean and ruleName', async () => {
      const rule = makeRule();
      const result = await rule.evaluate(validTrade, context);

      expect(result).toHaveProperty('passed');
      expect(typeof result.passed).toBe('boolean');
      expect(result).toHaveProperty('ruleName');
      expect(typeof result.ruleName).toBe('string');
      expect(result.ruleName.length).toBeGreaterThan(0);
    });

    it('never throws on well-formed input', async () => {
      const rule = makeRule();

      await expect(rule.evaluate(validTrade, context)).resolves.toBeDefined();
      await expect(rule.evaluate(invalidTrade, context)).resolves.toBeDefined();
    });

    it('returns passed=true for valid trade', async () => {
      const rule = makeRule();
      const result = await rule.evaluate(validTrade, context);

      expect(result.passed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns passed=false for invalid trade with a reason', async () => {
      const rule = makeRule();
      const result = await rule.evaluate(invalidTrade, context);

      expect(result.passed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    });

    it('is deterministic across repeated calls', async () => {
      const rule = makeRule();

      const result1 = await rule.evaluate(validTrade, context);
      const result2 = await rule.evaluate(validTrade, context);
      const result3 = await rule.evaluate(invalidTrade, context);
      const result4 = await rule.evaluate(invalidTrade, context);

      expect(result1.passed).toBe(result2.passed);
      expect(result3.passed).toBe(result4.passed);
      expect(result1.reason).toBe(result2.reason);
      expect(result3.reason).toBe(result4.reason);
    });

    it('is deterministic across fresh instances', async () => {
      const rule1 = makeRule();
      const rule2 = makeRule();

      const result1 = await rule1.evaluate(validTrade, context);
      const result2 = await rule2.evaluate(validTrade, context);

      expect(result1.passed).toBe(result2.passed);
      expect(result1.reason).toBe(result2.reason);
    });

    it('declares a stable name', () => {
      const rule = makeRule();
      expect(rule.name).toBeTruthy();
      expect(typeof rule.name).toBe('string');
      expect(rule.name.length).toBeGreaterThan(0);
    });
  });
}
