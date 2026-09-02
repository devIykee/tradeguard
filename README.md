# TradeGuard

**Pre-flight validator for Binance Agent OS MCP server**

Blocks agent-proposed trades violating user-defined risk rules *before* they reach Binance's own confirmation step. Two independent checks, not one replacing the other.

**Binance Agent OS Mini Hackathon — Track A: Trading Workflows**  
Submission deadline: 2026-09-08 23:59 UTC

---

## What This Does

TradeGuard intercepts trade proposals from AI agents using Binance's Agent OS MCP server and validates them against deterministic, config-driven risk rules:

- **MaxLeverageRule**: blocks futures trades exceeding 5x leverage (configurable)
- **MaxOrderSizeRule**: blocks orders exceeding $1,000 USDT notional (configurable)
- **PriceDeviationRule**: blocks trades with prices >2% off live market — catches stale/hallucinated prices
- **SymbolWhitelistRule**: blocks trades on symbols outside the allowed list (BTCUSDT, ETHUSDT, BNBUSDT by default)

If any rule fails, the trade is blocked **before reaching Binance's confirm-before-execute prompt**. If all rules pass, the trade proceeds to Binance's own human confirmation step normally.

---

## What This Does NOT Do (By Design)

- **No external-address risk screening**: Not applicable — Binance Agent OS has no withdrawal scope by design
- **No strategy generation**: TradeGuard validates trades, doesn't propose them
- **No backtesting**: Live validation only
- **No multi-exchange support**: Binance Agent OS only

---

## The Differentiator: PriceDeviationRule

**This is the core innovation.** Neither `acevod/trading-guardian-binance-agent-os` (advisory-only Claude Skill) nor other hackathon submissions implement this check.

If the agent's reasoning references "current BTCUSDT is $95,000" (from cached context, stale web search, or hallucination) but live market shows $68,000, **TradeGuard blocks the trade before the human sees it**.

Competitor implementations validate leverage and size but trust whatever price the agent proposes. TradeGuard fetches live price from Binance's public API and denies trades with >2% deviation.

---

## Architecture: PreToolUse Hook (Path C)

TradeGuard is implemented as a **Claude Code PreToolUse hook** that intercepts Binance MCP server tool calls at the harness layer.

**Why this path:**
- ✅ Deterministic enforcement — Claude cannot bypass via reasoning
- ✅ Preserves standard Binance flow (user runs `claude mcp add binance-mcp-server` normally)
- ✅ Two independent checks guaranteed: TradeGuard validates → Binance's confirm-before-execute prompt
- ✅ No OAuth registration, no public HTTPS endpoint, no MCP server boilerplate
- ✅ Legitimately distinct from advisory-only Skills (reasoning-layer enforcement)

**Rejected alternatives:**
- **Path A (MCP proxy)**: Rejected — OAuth barrier, no DCR support, security regression
- **Path B (Skill)**: Rejected — already done by competitor, LLM can bypass via reasoning

---

## Installation

### Prerequisites

- Node.js 22+
- Claude Code CLI (`claude` command available)
- Binance account with Agentic sub-account funded

### 1. Clone and build

```bash
git clone https://github.com/YOUR_USERNAME/tradeguard.git
cd tradeguard
npm install
npm run build
```

### 2. Connect Binance MCP server

```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
```

Follow the browser OAuth flow to authenticate. Grant scopes:
- ✅ Market data (required for price deviation check)
- ✅ Account (optional, for future % of equity rule)
- ✅ Trade (required for demo)
- ❌ Transfer (not needed)

### 3. Fund Agentic sub-account

TradeGuard validates trades, but the agent cannot fund the sub-account itself. Transfer assets manually via Binance web UI:

**https://www.binance.com/en/my/sub-account/asset-management/transfer?asset=BTC**

Recommend funding with only what you're willing to let the agent trade (e.g., $100-500 USDT for demo).

### 4. Install TradeGuard hook

Copy hook config to your project:

```bash
# From tradeguard repo root
cp .claude/hooks/tradeguard.json /path/to/your/project/.claude/hooks/

# Or add to ~/.claude/settings.json globally (not recommended for demo):
# {
#   "hooks": {
#     "PreToolUse": [
#       {
#         "matcher": "mcp__binance-mcp-server__.*",
#         "command": "/home/iyke/coding/tradeguard/bin/validate-trade.js"
#       }
#     ]
#   }
# }
```

**Important:** Update the `command` path in `tradeguard.json` to the absolute path of your `tradeguard/bin/validate-trade.js`.

### 5. Customize risk rules (optional)

Edit `config/risk-rules.json`:

```json
{
  "maxLeverage": 5,
  "maxOrderSizeUSDT": 1000,
  "maxPriceDeviationPct": 2.0,
  "allowedSymbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"]
}
```

Rebuild after changes: `npm run build`

---

## Demo Scenarios

### Scenario 1: Valid trade (should pass both checks)

In Claude Code:

```
Buy 0.001 BTC at market on Binance spot
```

**Expected flow:**
1. Agent calls `mcp__binance-mcp-server__place_order`
2. TradeGuard hook fires → validates against rules → all pass
3. Binance's confirm-before-execute prompt shows restated order
4. User confirms → trade executes

### Scenario 2: Excessive leverage (should be blocked by TradeGuard)

```
Open a 10x leveraged long position on BTCUSDT, 0.01 BTC
```

**Expected flow:**
1. Agent calls `mcp__binance-mcp-server__place_order` with `leverage: 10`
2. TradeGuard hook fires → MaxLeverageRule fails (10x > 5x max)
3. **Trade blocked** — denial reason shown to Claude: "Leverage 10x exceeds max allowed 5x"
4. Claude sees the block and informs the user (does not reach Binance's confirm prompt)

### Scenario 3: Symbol not in whitelist (should be blocked by TradeGuard)

```
Buy 100 DOGE at market on Binance spot
```

**Expected flow:**
1. Agent calls `mcp__binance-mcp-server__place_order` with `symbol: "DOGEUSDT"`
2. TradeGuard hook fires → SymbolWhitelistRule fails
3. **Trade blocked** — denial reason: "Symbol 'DOGEUSDT' not in whitelist. Allowed: btcusdt, ethusdt, bnbusdt"

### Scenario 4: Stale price (should be blocked by PriceDeviationRule)

Manually test by proposing a limit order with a price 5% off live market:

```
Place a limit buy order for 0.01 BTC at $75,000 (when live market is ~$65,000)
```

**Expected flow:**
1. Agent calls `mcp__binance-mcp-server__place_order` with `price: 75000`
2. TradeGuard hook fires → PriceDeviationRule fetches live price ($65,000) → calculates deviation (15.4%)
3. **Trade blocked** — denial reason: "Proposed price $75000.00 deviates 15.38% from live market $65000.00 (max allowed 2.0%)"

---

## Testing

Run unit tests (61 tests, all rules covered):

```bash
npm test
```

Run specific test suites:

```bash
npm run test:unit                    # All unit tests
npm test tests/unit/RuleEngine.test.ts
npm test tests/unit/PriceDeviationRule.test.ts
```

Manual hook test (from project root):

```bash
node bin/validate-trade.js <<'EOF'
{
  "tool_name": "mcp__binance-mcp-server__place_order",
  "tool_input": {
    "symbol": "BTCUSDT",
    "side": "BUY",
    "type": "MARKET",
    "quantity": 0.001,
    "leverage": 10
  },
  "session_id": "test",
  "tool_use_id": "test",
  "hook_event_name": "PreToolUse"
}
EOF
```

Expected output: `"permissionDecision": "deny"` with reason about leverage.

---

## Project Structure

```
/src
  /rules              Pure logic, zero I/O — RuleEngine + individual rules
  /interfaces         Dependency inversion — MarketDataSource, AccountReader, TradeExecutor
  /binance            BinanceMcpClient (typed wrapper, placeholder until MCP connection established)
  /config             risk-rules-loader (Zod validation)

/tests
  /unit               61 tests — contract suite + per-rule tests
  /integration        (reserved for real MCP integration tests)

/bin
  validate-trade.js   Hook entry point (reads stdin, writes hookSpecificOutput to stdout)

/config
  risk-rules.json     User-editable thresholds

/.claude/hooks
  tradeguard.json     Hook registration (copy to your project)

ARCHITECTURE.md       Full design doc (Phase 1 deliverable)
PHASE_0_FINDINGS.md   Doc verification report
PHASE_0.5_COMPETITIVE.md   Competitive analysis
```

---

## SOLID Principles (Enforced by Tests)

- **Single Responsibility**: RuleEngine orchestrates, rules evaluate one dimension each, no overlap
- **Open/Closed**: Adding VelocityLimitRule = one new file + one config line, RuleEngine never changes
- **Liskov Substitution**: Contract test suite (`rule-contract.ts`) proves every TradeRule is substitutable
- **Interface Segregation**: MarketDataSource, AccountReader, TradeExecutor are separate — rules depend only on what they need
- **Dependency Inversion**: Rules depend on interfaces, never on BinanceMcpClient directly — fully unit testable with fakes

---

## Limitations

### Phase 0.5 Competitive Check

No official hackathon registry exists — entries are posted as Twitter/X replies. GitHub search found:

- **acevod/trading-guardian-binance-agent-os** (2026-08-29): Advisory-only Claude Skill with threshold tiers — overlaps conceptually but uses LLM reasoning, not deterministic enforcement
- **tokyoville741/guardrail-desk** (2026-09-01): Minimal Python proof-of-concept, GO/NO-GO only
- **eikarna/binance-agent-mcp** (2026-09-02): Alternative MCP server wrapping Binance REST API, not a validator for Agent OS

Other entries may exist unpublished. This check is best-effort only.

### MCP Tool Names Unconfirmed

Binance docs do not list MCP tool names. The `tools/list` endpoint returns 401 without OAuth credentials. Tool names like `mcp__binance-mcp-server__place_order` are assumed based on MCP naming convention but unverified until a live connection is established.

The hook script matches `mcp__binance-mcp-server__.*` to intercept all Binance tools regardless of exact names.

---

## Future Enhancements (Not Implemented in Core Tier)

- **VelocityLimitRule**: Max N trades/hour + cumulative drawdown circuit breaker
- **% of equity order size cap**: Requires AccountReader.getBalance() integration
- **Per-symbol price deviation thresholds**: Higher tolerance for volatile pairs (config schema supports it, rule doesn't use it yet)
- **Real BinanceMcpClient implementation**: Once tool names confirmed, replace placeholder with actual MCP calls

---

## License

MIT

---

## Submission

- **Track**: A — Trading Workflows
- **GitHub**: [https://github.com/YOUR_USERNAME/tradeguard](https://github.com/YOUR_USERNAME/tradeguard)
- **Video demo**: [Link to demo video showing blocked and passed trades]
- **Replication guide**: See Installation section above

**Entry mechanic:**
1. Follow @Binance on X
2. Repost the hackathon announcement
3. Reply or quote-repost with video/demo + this GitHub link
4. Complete the linked survey

---

Built for Binance Agent OS Mini Hackathon, September 2026.
