import type { TradeRule, ProposedTrade, RuleContext, ValidationResult } from '../interfaces/TradeRule.js';

/**
 * MaxLeverageRule: blocks trades with leverage exceeding configured max.
 *
 * ## Why this matters
 *
 * High leverage amplifies both gains and losses. A 20x leveraged position can be
 * liquidated on a 5% adverse move. This rule enforces a ceiling to prevent the
 * agent from proposing excessively risky futures positions.
 *
 * ## Scope
 *
 * Applies only to FUTURES trades. SPOT trades have no leverage field and always pass.
 *
 * ## Dependencies
 *
 * None — this is a pure function over the trade object.
 */
export class MaxLeverageRule implements TradeRule {
  readonly name = 'max-leverage';

  constructor(private readonly maxLeverage: number) {
    if (maxLeverage <= 0 || !Number.isFinite(maxLeverage)) {
      throw new Error(`maxLeverage must be a positive finite number, got ${maxLeverage}`);
    }
  }

  async evaluate(trade: ProposedTrade, _context: RuleContext): Promise<ValidationResult> {
    // SPOT trades have no leverage — always pass
    if (trade.market !== 'FUTURES') {
      return { passed: true, ruleName: this.name };
    }

    const leverage = trade.leverage ?? 1; // Default to 1x if not specified

    if (leverage > this.maxLeverage) {
      return {
        passed: false,
        ruleName: this.name,
        reason: `Leverage ${leverage}x exceeds max allowed ${this.maxLeverage}x`,
      };
    }

    return { passed: true, ruleName: this.name };
  }
}
