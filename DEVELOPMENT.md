# TradeGuard Development Guide

**Internal development documentation for TradeGuard maintainers**

---

## Project Philosophy

TradeGuard enforces risk rules deterministically at the harness layer, not through LLM reasoning. This is the core architectural decision that distinguishes it from advisory-only approaches.

**Design Principles:**
1. **Fail-safe defaults**: Unknown data → deny, not allow
2. **Single source of truth**: Config file drives all thresholds
3. **Zero trust in LLM reasoning**: Hook enforcement, not prompt instructions
4. **Explicit over implicit**: Clear error messages naming the violated rule

---

## Architecture Deep Dive

### Hook Execution Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Agent proposes trade via Binance MCP                     │
│    mcp__binance-mcp-server__place_order(...)                │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 2. PreToolUse hook fires (before MCP call)                  │
│    validate-trade.js receives tool_input as JSON on stdin   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 3. Parse ProposedTrade from tool_input                      │
│    symbol, side, quantity, leverage, price, etc.            │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 4. Load config/risk-rules.json (Zod validation)             │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 5. Instantiate rules with config + MarketDataSource         │
│    MaxLeverageRule, SymbolWhitelistRule,                    │
│    MaxOrderSizeRule, PriceDeviationRule                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 6. RuleEngine.evaluate(trade, context)                      │
│    Short-circuits on first failure                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              │                 │
      ┌───────▼──────┐   ┌──────▼───────┐
      │ Rule passed  │   │ Rule failed  │
      └───────┬──────┘   └──────┬───────┘
              │                 │
┌─────────────▼─────────────────▼─────────────────────────────┐
│ 7. Write hookSpecificOutput to stdout                        │
│    { permissionDecision: "allow" | "deny",                  │
│      permissionDecisionReason: "..." }                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              │                 │
      ┌───────▼──────┐   ┌──────▼───────┐
      │ Allow: tool  │   │ Deny: block  │
      │ proceeds to  │   │ tool call,   │
      │ Binance MCP  │   │ show reason  │
      └───────┬──────┘   └──────────────┘
              │
┌─────────────▼─────────────────────────────────────────────┐
│ 8. Binance's confirm-before-execute (human approval)      │
└───────────────────────────────────────────────────────────┘
```

### Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                     Hook Entry Point                         │
│                  bin/validate-trade.js                       │
│                                                              │
│  (reads stdin, writes stdout, orchestrates validation)       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ├──► config/risk-rules-loader
                         │    (loads + validates JSON config)
                         │
                         ├──► rules/RuleEngine
                         │    │
                         │    └──► interfaces/TradeRule
                         │         (contract: evaluate() → ValidationResult)
                         │
                         └──► Individual Rules (depend on interfaces only)
                              │
                              ├─► MaxLeverageRule (no deps)
                              ├─► SymbolWhitelistRule (no deps)
                              ├─► MaxOrderSizeRule (MarketDataSource)
                              └─► PriceDeviationRule (MarketDataSource)
                                   │
                                   └──► interfaces/MarketDataSource
                                        (contract: getLivePrice() → number)
                                         │
                                         └─── SimpleBinanceMarketData
                                              (hook: fetch from api.binance.com)
                                              │
                                              └─── BinanceMcpClient (future)
                                                   (SDK: call via MCP tools)
```

**Key insight:** Rules depend on *interfaces*, never on concrete implementations. This enables:
- Unit testing with mocks (zero network calls)
- Swapping data sources (public API → MCP tools → mock data)
- Adding new rules without modifying existing ones

---

## Rule Implementation Checklist

When adding a new rule (e.g., VelocityLimitRule), follow this sequence:

### 1. Define the Rule Class

File: `src/rules/YourNewRule.ts`

```typescript
import type { TradeRule, ProposedTrade, RuleContext, ValidationResult } from '../interfaces/TradeRule.js';

export class YourNewRule implements TradeRule {
  readonly name = 'your-new-rule';

  constructor(private readonly threshold: number) {
    // Validate constructor args
    if (threshold <= 0) throw new Error('threshold must be positive');
  }

  async evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult> {
    // 1. Extract relevant fields from trade
    // 2. Apply rule logic
    // 3. Return { passed: boolean, ruleName: string, reason?: string }
    
    if (/* violation */) {
      return {
        passed: false,
        ruleName: this.name,
        reason: `Clear explanation of what was violated and why`,
      };
    }

    return { passed: true, ruleName: this.name };
  }
}
```

### 2. Write Contract Tests

File: `tests/unit/YourNewRule.test.ts`

```typescript
import { describeRuleContract } from './rule-contract.js';
import { YourNewRule } from '../../src/rules/YourNewRule.js';

describe('YourNewRule', () => {
  const validTrade = { /* trade that passes */ };
  const invalidTrade = { /* trade that fails */ };

  // Run shared contract suite (enforces Liskov Substitution)
  describeRuleContract(
    'YourNewRule',
    () => new YourNewRule(threshold),
    validTrade,
    invalidTrade,
  );

  // Rule-specific tests
  it('handles edge case X', async () => { /* ... */ });
  it('includes helpful context in denial reason', async () => { /* ... */ });
});
```

### 3. Update Config Schema

File: `src/config/risk-rules-loader.ts`

```typescript
export const RiskRulesConfigSchema = z.object({
  // ... existing fields
  yourNewThreshold: z.number().min(1),
});
```

File: `config/risk-rules.json`

```json
{
  "maxLeverage": 5,
  "yourNewThreshold": 100
}
```

### 4. Wire into Hook

File: `bin/validate-trade.js`

```javascript
const { YourNewRule } = await import(`${PROJECT_ROOT}/dist/rules/YourNewRule.js`);

// ... in main():
const rules = [
  new MaxLeverageRule(config.maxLeverage),
  new YourNewRule(config.yourNewThreshold), // Add here
  // ... other rules
];
```

### 5. Rebuild and Test

```bash
npm run build
npm test
node bin/validate-trade.js < test-input.json
```

**Rule must satisfy contract tests** (deterministic, never throws, returns ValidationResult, etc.) or RuleEngine will not accept it.

---

## Testing Strategy

### Unit Tests (61 tests)

**What they cover:**
- RuleEngine orchestration (short-circuit, Liskov substitution)
- Each rule in isolation with mocked dependencies
- Contract compliance (all rules pass shared test suite)
- Edge cases (exact thresholds, malformed input, missing fields)

**What they DON'T cover:**
- Real network calls to Binance API
- Real MCP tool invocations
- Hook script execution in Claude Code environment

**Run them:**
```bash
npm test                             # All tests
npm test MaxLeverageRule.test.ts    # Specific rule
npm test -- --coverage               # With coverage report
```

### Integration Tests (manual, requires real connection)

**Setup:**
1. Connect Binance MCP server: `claude mcp add binance-mcp-server ...`
2. Fund Agentic sub-account with $100 USDT
3. Install hook in a test project
4. Open Claude Code in that project

**Test cases:**
```
# Case 1: Valid trade (should pass)
"Buy 0.001 BTC at market on Binance spot"
→ TradeGuard allows → Binance confirm prompt shows → User confirms → Executes

# Case 2: Excessive leverage
"Open a 10x leveraged long on BTCUSDT"
→ TradeGuard denies with reason: "Leverage 10x exceeds max allowed 5x"

# Case 3: Whitelist violation
"Buy 100 DOGE at market"
→ TradeGuard denies with reason: "Symbol 'DOGEUSDT' not in whitelist"

# Case 4: Price deviation (requires manual crafting)
Propose limit buy at price 10% above live market
→ TradeGuard denies with reason: "Proposed price deviates X% from live market"
```

**Verify:**
- Denial reasons appear in chat (shown to agent)
- Allowed trades reach Binance confirm prompt
- No trades bypass TradeGuard

### Hook Script Tests (unit-level, no Claude Code)

**Direct stdin/stdout test:**
```bash
echo '{"tool_name":"mcp__binance-mcp-server__place_order","tool_input":{"symbol":"BTCUSDT","leverage":10},"session_id":"test","tool_use_id":"test","hook_event_name":"PreToolUse"}' | node bin/validate-trade.js
```

Expected output: `permissionDecision: "deny"` with leverage reason

**Useful for:**
- Debugging rule logic without full Claude Code setup
- CI/CD validation (can run in GitHub Actions)
- Quick iteration on threshold tuning

---

## Configuration Tuning

### Risk Rules Config

File: `config/risk-rules.json`

```json
{
  "maxLeverage": 5,           // Futures only, 1-125 range
  "maxOrderSizeUSDT": 1000,   // All trades, absolute cap
  "maxPriceDeviationPct": 2.0,// Limit/stop orders, 0.1-50 range
  "allowedSymbols": [         // Case-insensitive, must end in USDT
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT"
  ]
}
```

**Validation:**
- Schema enforced by Zod at runtime
- Invalid config → hook fails with clear error message
- JSON syntax errors → hook fails with parse error

**Per-user customization:**
- Recommended: user forks repo, edits config, rebuilds
- Alternative: environment variable override (not implemented in core tier)

**Reload behavior:**
- Config loaded on every hook invocation (no caching)
- Changes apply immediately without restarting Claude Code

### Threshold Selection Guidelines

**maxLeverage (default: 5x)**
- Conservative: 1-3x (low risk, limits gains)
- Moderate: 4-7x (balance of risk/reward)
- Aggressive: 8-20x (high risk, fast liquidation)
- Do NOT exceed 20x for demo — liquidation risk too high

**maxOrderSizeUSDT (default: 1000)**
- Scale to account size: aim for <15% of total equity
- $100 account → max $15 per trade
- $10,000 account → max $1,500 per trade
- Prevents single-trade ruin

**maxPriceDeviationPct (default: 2.0%)**
- Tight: 1.0-1.5% (low false positives, may block legitimate orders in volatile markets)
- Moderate: 2.0-3.0% (balance, recommended)
- Loose: 4.0-5.0% (catches only extreme hallucinations, allows more stale data through)
- Check ATR: if symbol 1-min ATR > 2%, consider raising threshold for that symbol

**allowedSymbols (default: BTC/ETH/BNB)**
- Major pairs only: low spread, high liquidity, less manipulation risk
- Add new symbols: ensure they're real Binance symbols (uppercase, end in USDT)
- Typo protection: agent typos "BTCUSD" → denied (not in whitelist)

---

## Troubleshooting

### Hook Not Firing

**Symptoms:**
- Proposed trade reaches Binance confirm prompt without TradeGuard validation
- No denial messages for obvious violations (e.g., 10x leverage)

**Diagnostics:**
```bash
# 1. Check hook registration
cat .claude/hooks/tradeguard.json
# Verify: matcher is "mcp__binance-mcp-server__.*"
# Verify: command path is absolute and correct

# 2. Check hook script is executable
ls -l /path/to/tradeguard/bin/validate-trade.js
# Should show: -rwxr-xr-x (x = executable)

# 3. Test hook script directly
echo '{"tool_name":"mcp__binance-mcp-server__test","tool_input":{"symbol":"BTCUSDT","leverage":10},"session_id":"test","tool_use_id":"test","hook_event_name":"PreToolUse"}' | node /path/to/tradeguard/bin/validate-trade.js
# Should output: permissionDecision: "deny"

# 4. Check Claude Code hook logs (if available)
# Look for: hook execution errors, matcher mismatches, timeout
```

**Common fixes:**
- Wrong matcher: change to `mcp__binance-mcp-server__.*` (wildcard, not specific tool name)
- Relative path: change to absolute path in hook config
- Not executable: `chmod +x bin/validate-trade.js`
- Wrong project: hook config must be in `.claude/hooks/` of the project where you're trading

### Market Data Fetch Failing

**Symptoms:**
- All trades denied with: "Cannot verify order size: market data unavailable"
- Hook script stderr: "fetch failed" or "Binance API error"

**Diagnostics:**
```bash
# Test Binance public API directly
curl 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'
# Should return: {"symbol":"BTCUSDT","price":"65432.10"}

# Check DNS resolution
nslookup api.binance.com
ping api.binance.com
```

**Common causes:**
- Network sandbox (WSL, VPN required)
- Binance API blocked by ISP/firewall
- Rate limiting (429 error) — add delay between requests

**Workarounds:**
- Enable VPN for Binance access
- Use alternative data source (e.g., CoinGecko API)
- Mock market data for testing (edit SimpleBinanceMarketData class)

### Tests Failing After Config Change

**Symptoms:**
- Tests that passed before now fail
- Error: "expected 2.0, got 3.0" or similar

**Cause:**
- Tests hardcode expected values (e.g., `expect(result.reason).toContain('2.0%')`)
- Config changed (e.g., maxPriceDeviationPct: 2.0 → 3.0)
- Tests now assert old value, not new config

**Fix:**
- Update test expectations to match new config
- Or: inject config into test factories (better long-term)

---

## Performance Considerations

### Hook Latency

**Target:** <500ms per validation (imperceptible to user)

**Measured (mock data):**
- Config load: ~5ms
- Rule instantiation: <1ms
- RuleEngine.evaluate (4 rules): <10ms
- **Total (no network):** ~15ms ✅

**Measured (real network):**
- Binance public API call (getLivePrice): 100-300ms
- **Total (2 rules fetch price):** ~250ms ✅

**Bottleneck:** Network latency for live price fetch

**Optimization (future):**
- Cache live prices for 5 seconds (reduce API calls for rapid successive trades)
- Pre-fetch prices for whitelisted symbols on session start
- Use WebSocket ticker stream instead of REST API (real-time, no polling)

### Memory Usage

**Typical:**
- Node.js baseline: ~50 MB
- TradeGuard loaded: ~55 MB (+5 MB)
- Per-validation: ~100 KB allocation (ephemeral, GC'd immediately)

**No memory leaks detected** (ran 1000 validations in loop, memory stable)

---

## Security Considerations

### Threat Model

**In scope:**
- Stale/hallucinated prices from agent
- Agent bypassing rules via reasoning
- Misconfigured thresholds (too permissive)
- Typo'd symbols leading to wrong trades

**Out of scope:**
- Malicious agent (assume agent is well-intentioned but error-prone)
- Compromise of Binance MCP server (trust Binance's security)
- Phishing/spoofed MCP endpoints (user's responsibility to verify URL)
- Hook script tampering (file system access = game over anyway)

### Input Validation

**Hook script:**
- JSON parsing wrapped in try-catch (malformed input → deny)
- Tool name validated (only Binance MCP tools processed)
- Numeric fields coerced with fallbacks (undefined → default, not crash)

**Config:**
- Zod schema validation (invalid JSON → startup error)
- Range checks (e.g., leverage 1-125, not negative or Infinity)

**Rules:**
- Never throw on malformed input (contract requirement)
- Return `passed: false` with clear reason instead

### Fail-Safe Defaults

**Philosophy:** When in doubt, deny

**Examples:**
- Market data unavailable → deny (cannot verify price/size)
- Config file missing → deny (no thresholds to enforce)
- Unknown symbol → deny (not in whitelist)
- Parse error → deny (cannot validate malformed input)

**Trade-off:** False negatives (legitimate trades blocked) preferred over false positives (bad trades allowed)

### No Secrets in Code

**TradeGuard does not:**
- Store API keys
- Handle OAuth tokens (Binance MCP server manages that)
- Access user's main Binance account (only Agentic sub-account)
- Execute withdrawals (Binance has no withdrawal scope for Agent OS)

**Config file contains:**
- Public thresholds only (no sensitive data)
- Can be committed to public GitHub repo safely

---

## Future Enhancements

### VelocityLimitRule (Nice-to-Have Tier)

**Concept:**
- Max N trades per hour (e.g., 10)
- Cumulative drawdown circuit breaker (e.g., auto-pause after $500 loss in 24h)

**Implementation:**
- Requires persistent state (JSON file or in-memory cache)
- Read recent trades from state file
- Count trades in rolling window
- Sum P&L for circuit breaker

**Challenges:**
- State management (where to store? how to clean up old data?)
- Trade result tracking (need to know if trade was profitable)
- Session boundary (reset on Claude Code restart or persist across sessions?)

**Pattern source:** BNB Chain hackathon "Guarded Alpha" winner

### Percentage of Equity Order Size

**Concept:**
- MaxOrderSizeRule checks notional / equity < threshold (e.g., 15%)
- Requires AccountReader.getBalance() integration

**Implementation:**
- Add `maxOrderSizePctEquity: number` to config
- MaxOrderSizeRule calls `accountReader.getBalance()`
- Calculate: `(quantity * price) / totalEquityUSDT * 100`
- Compare against threshold

**Challenges:**
- Requires Account scope (user must grant during MCP setup)
- Balance fetch adds latency (~200ms)
- Multi-wallet accounts (Spot + Futures balances, how to sum?)

### Per-Symbol Price Deviation Thresholds

**Concept:**
- High-volatility pairs (e.g., SOLUSDT) get higher tolerance (3-4%)
- Low-volatility pairs (e.g., stablecoins) get tighter tolerance (0.5%)

**Implementation:**
- Config: `symbolSpecificDeviations: { "SOLUSDT": 3.5, "USDCUSDT": 0.5 }`
- PriceDeviationRule checks symbol-specific override before fallback to global

**Already supported in config schema** — rule just needs to read it

### Real BinanceMcpClient Implementation

**Current state:** Placeholder (throws "not implemented")

**Needed once MCP connected:**
1. User runs: `claude mcp add binance-mcp-server`
2. Inspect tool names via `/mcp` menu
3. Update BinanceMcpClient with real tool names
4. Replace SimpleBinanceMarketData with BinanceMcpClient in hook script

**MCP call pattern (pseudocode):**
```javascript
async function callMcpTool(toolName, input) {
  // Call via @modelcontextprotocol/sdk or Claude Code's MCP client
  const response = await mcpClient.callTool({ name: toolName, arguments: input });
  return JSON.parse(response.content[0].text);
}
```

---

## Code Style Guide

**Follow existing patterns:**

### Interfaces (Pure TypeScript)

```typescript
// NO implementation, just contract
export interface TradeRule {
  readonly name: string;
  evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult>;
}
```

### Classes (Implementation)

```typescript
export class MaxLeverageRule implements TradeRule {
  readonly name = 'max-leverage';

  constructor(private readonly maxLeverage: number) {
    // Validate constructor args
    if (maxLeverage <= 0) throw new Error('...');
  }

  async evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult> {
    // Implementation
  }
}
```

### Tests (Vitest)

```typescript
import { describe, it, expect } from 'vitest';

describe('ComponentName', () => {
  it('does X when Y', async () => {
    const result = await doThing();
    expect(result).toBe(expected);
  });
});
```

### Comments

**Write comments for:**
- Why (rationale for non-obvious decisions)
- Gotchas (edge cases, browser quirks)
- Contract guarantees (interface documentation)

**Don't write comments for:**
- What (self-documenting code is better)
- How (code shows how)

**Example — GOOD:**
```typescript
// Normalize to lowercase for case-insensitive comparison.
// Binance symbols are uppercase by convention, but agent may propose lowercase.
const symbolLower = trade.symbol.toLowerCase();
```

**Example — BAD:**
```typescript
// Convert symbol to lowercase
const symbolLower = trade.symbol.toLowerCase();
```

---

## Deployment Checklist

Before releasing a new version:

- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] Hook script tested manually with valid + invalid trades
- [ ] Config validation tested (malformed JSON, out-of-range values)
- [ ] README updated with new features/thresholds
- [ ] ARCHITECTURE.md updated if design changed
- [ ] Git tag created: `git tag v1.0.0`
- [ ] Pushed to GitHub: `git push && git push --tags`
- [ ] Release notes written (CHANGELOG.md or GitHub release)

---

## License

MIT — see LICENSE file
