import type { TradeRule, ProposedTrade, RuleContext, ValidationResult } from '../interfaces/index.js';

/**
 * RuleEngine: orchestrates validation of a proposed trade against a list of rules.
 *
 * ## Single Responsibility
 *
 * This class has exactly one job: take a ProposedTrade and a list of TradeRule,
 * return a ValidationResult. It never imports from /src/binance or /src/hook.
 * It doesn't know what "leverage" means as a risk concept, only that rules
 * evaluate trades and return pass/fail.
 *
 * ## Open/Closed Principle
 *
 * Adding VelocityLimitRule later means adding one new file implementing TradeRule
 * and one line in the config-driven rule list. RuleEngine never changes.
 *
 * ## Liskov Substitution Principle
 *
 * RuleEngine treats every TradeRule identically. No special-casing for specific
 * rule types. A test proves this by running the engine against a fake rule that
 * always passes and a fake rule that always fails.
 */
export class RuleEngine {
  private readonly rules: TradeRule[];

  /**
   * @param rules List of rules to evaluate, in order. First failure short-circuits.
   */
  constructor(rules: TradeRule[]) {
    this.rules = rules;
  }

  /**
   * Evaluate a proposed trade against all registered rules.
   *
   * Short-circuits on first failure: if rule 1 fails, rules 2-N don't run.
   * This is intentional — no point checking price deviation if leverage already
   * violated. The first violation is the blocking reason shown to Claude.
   *
   * @param trade The proposed trade to validate
   * @param context Validation context (timestamp, session info)
   * @returns ValidationResult from first failing rule, or passed=true if all pass
   */
  async evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult> {
    for (const rule of this.rules) {
      const result = await rule.evaluate(trade, context);
      if (!result.passed) {
        // First violation — short-circuit and return
        return result;
      }
    }

    // All rules passed
    return {
      passed: true,
      ruleName: 'all-rules',
    };
  }

  /**
   * Get the list of registered rules (for debugging/logging).
   */
  getRules(): readonly TradeRule[] {
    return this.rules;
  }
}
