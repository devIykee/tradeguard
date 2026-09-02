import type { TradeRule, ProposedTrade, RuleContext, ValidationResult } from '../interfaces/TradeRule.js';

/**
 * SymbolWhitelistRule: blocks trades on symbols not in the allowed list.
 *
 * ## Why this matters
 *
 * - Prevents the agent from trading obscure/illiquid pairs where spreads are wide
 * - Catches typos or hallucinated symbols (e.g., "BTCUSD" instead of "BTCUSDT")
 * - Limits exposure to assets the user doesn't want the agent touching
 *
 * ## Scope
 *
 * Applies to all trade types (SPOT and FUTURES).
 *
 * ## Case sensitivity
 *
 * Symbol comparison is case-insensitive (BTCUSDT, btcusdt, BtcUsdT all match).
 * Binance symbols are uppercase by convention, but the agent may propose lowercase.
 *
 * ## Dependencies
 *
 * None — this is a pure function over the trade object and config.
 */
export class SymbolWhitelistRule implements TradeRule {
  readonly name = 'symbol-whitelist';
  private readonly allowedSymbolsLowercase: Set<string>;

  constructor(allowedSymbols: string[]) {
    if (allowedSymbols.length === 0) {
      throw new Error('allowedSymbols cannot be empty — at least one symbol must be whitelisted');
    }
    // Normalize to lowercase for case-insensitive comparison
    this.allowedSymbolsLowercase = new Set(allowedSymbols.map(s => s.toLowerCase()));
  }

  async evaluate(trade: ProposedTrade, _context: RuleContext): Promise<ValidationResult> {
    const symbolLower = trade.symbol.toLowerCase();

    if (!this.allowedSymbolsLowercase.has(symbolLower)) {
      const allowedList = Array.from(this.allowedSymbolsLowercase).join(', ');
      return {
        passed: false,
        ruleName: this.name,
        reason: `Symbol "${trade.symbol}" not in whitelist. Allowed: ${allowedList}`,
      };
    }

    return { passed: true, ruleName: this.name };
  }

  /**
   * Get the allowed symbols (for debugging/logging).
   */
  getAllowedSymbols(): readonly string[] {
    return Array.from(this.allowedSymbolsLowercase);
  }
}
