/**
 * A single risk rule that evaluates one dimension of a proposed trade.
 *
 * ## Contract
 *
 * Every implementation must satisfy:
 *
 * 1. **Deterministic:** Same input, same result, always. No clocks, no randomness,
 *    no external state changes the outcome for identical calls.
 * 2. **Never throws:** Malformed input returns a failed `ValidationResult` with a
 *    clear reason, never throws. A rule that threw on one bad field would fail an
 *    entire request over it.
 * 3. **Single responsibility:** Each rule checks exactly one thing. MaxLeverageRule
 *    checks leverage, PriceDeviationRule checks price deviation. Rules don't
 *    overlap or combine checks.
 * 4. **Stateless (with exception):** Most rules are pure functions over the trade
 *    and context. VelocityLimitRule is the exception — it may read recent trade
 *    history, but that state is injected, not global.
 *
 * ## Liskov guarantee
 *
 * RuleEngine iterates a list of TradeRule and treats every implementation
 * identically. A shared contract test suite (`tests/unit/rule-contract.test.ts`)
 * runs every implementation through the same invariants, enforcing substitutability.
 */

export interface ProposedTrade {
  /** Trading pair, e.g. "BTCUSDT" */
  symbol: string;

  /** BUY or SELL */
  side: 'BUY' | 'SELL';

  /** Order type: MARKET, LIMIT, STOP, STOP_LIMIT */
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';

  /** Quantity in base asset (e.g. 0.01 BTC for BTCUSDT) */
  quantity: number;

  /** Limit price, required for LIMIT and STOP_LIMIT orders */
  price?: number;

  /** Stop price, required for STOP and STOP_LIMIT orders */
  stopPrice?: number;

  /** Leverage multiplier, only for futures */
  leverage?: number;

  /** Market type: SPOT or FUTURES */
  market: 'SPOT' | 'FUTURES';

  /** Original tool input from MCP call (for logging/debugging) */
  rawToolInput?: Record<string, unknown>;
}

export interface RuleContext {
  /** Timestamp when validation started (ISO 8601) */
  validationTimestamp: string;

  /** Session ID from the hook input */
  sessionId?: string;

  /** Tool use ID from the hook input */
  toolUseId?: string;
}

export interface ValidationResult {
  /** True if the trade passes this rule, false if it violates */
  passed: boolean;

  /** Human-readable reason for denial, shown to Claude. Omit if passed. */
  reason?: string;

  /** Rule name that produced this result (for logging/debugging) */
  ruleName: string;

  /**
   * Additional context added to Claude's next turn (optional).
   * Use sparingly — only when the rule's outcome should inform Claude's
   * reasoning beyond just "this was blocked."
   */
  additionalContext?: string;
}

export interface TradeRule {
  /**
   * Stable identifier for this rule, used in logs and error messages.
   * Should be kebab-case, e.g. "max-leverage", "price-deviation".
   */
  readonly name: string;

  /**
   * Evaluate a proposed trade against this rule.
   *
   * @param trade The proposed trade to validate
   * @param context Validation context (timestamp, session info)
   * @returns ValidationResult indicating pass/fail and reason
   */
  evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult>;
}
