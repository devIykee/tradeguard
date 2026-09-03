# TradeGuard Architecture

**Status:** Phase 1 deliverable — awaiting review before implementation

---

## The Gap

Binance's own docs state: *"AI can make mistakes, act on outdated or hallucinated information, or send incorrect parameters — always verify before execution."* Today that verification is a human reading a restated order under time pressure. Nothing structured stands between the agent's proposal and that human confirmation step.

TradeGuard fills that gap with **deterministic, config-driven risk rules** that block agent-proposed trades violating user-defined thresholds *before* they reach Binance's own confirmation prompt. Two independent checks, not one replacing the other.

---

## Interception Architecture Decision

### Path A (Network-Layer Proxy) — **REJECTED**

**Concept:** TradeGuard runs as a local MCP server that wraps the Binance MCP endpoint, re-exposing filtered trade tools to Claude Code.

**Why rejected:**

1. **OAuth barrier:** Binance's authorization server requires `client_id_metadata_document_supported: true` (RFC 9728) but provides no `registration_endpoint` (RFC 7591 DCR). A local proxy would need its own OAuth client registration with a publicly-hosted HTTPS metadata document — not feasible for a 7-day hackathon demo that judges should be able to replicate without pre-registering TradeGuard as a Binance OAuth client.

2. **Documentation violation:** Binance explicitly warns: *"Never paste the MCP endpoint into an AI chat and ask it to install the server, and never open the endpoint directly in your browser. Follow the setup steps for your client in the tabs below instead."* While this targets phishing/misconfig, the spirit is clear: follow the sanctioned per-client flow, don't DIY-proxy it.

3. **Security regression:** Storing a Trade-scoped OAuth bearer token on disk (required for the proxy to forward authenticated calls) is a step backward compared to Claude Code managing the credential directly via the standard flow.

4. **Confirmation-layer ambiguity:** If Claude Code connects to TradeGuard's wrapped endpoint, Claude Code's permission prompt applies to TradeGuard's tool, but TradeGuard's inner call to Binance executes without a separate prompt. Does this *replace* Binance's confirm-before-execute or add a second layer? Unclear without testing, and if it replaces it, that violates the "two independent checks" goal.

### Path B (Reasoning-Layer Skill) — **FUNCTIONAL BUT WEAKER**

**Concept:** TradeGuard is a Claude Code Skill — markdown instructions + local CLI validation script — that Claude is instructed to always invoke on proposed Binance trades.

**Why suboptimal:**

- **Enforcement is non-deterministic:** The LLM applies the rule via reasoning. It can silently misapply thresholds, skip the check, or rewrite the instruction mid-session.
- **Already done:** `acevod/trading-guardian-binance-agent-os` (created 2026-08-29) is a Skill-based risk copilot with threshold tiers, Devil's Advocate analysis, and GO/NO-GO workflow. Building Path B duplicates that work without material improvement.

### Path C (Harness-Layer Hook) — **RECOMMENDED**

**Concept:** TradeGuard is implemented as a **Claude Code PreToolUse hook** that matches Binance MCP server tool patterns (`mcp__binance-mcp-server__.*`) and validates proposed trade parameters against the rule engine before execution.

**Why this is the right path:**

1. **Deterministic enforcement:** The hook fires at the harness layer, before the tool reaches the MCP server. Claude cannot bypass it via reasoning — it's a runtime gate, not a prompt instruction.

2. **Preserves the standard flow:** The user runs the documented `claude mcp add binance-mcp-server` command and authenticates normally. TradeGuard's hook intercepts *after* Claude Code resolves the tool call but *before* it forwards to the MCP server.

3. **Two independent checks, guaranteed:**
   - **Check 1 (TradeGuard):** Hook evaluates trade against risk rules, returns `permissionDecision: "deny"` on violation.
   - **Check 2 (Binance + human):** If TradeGuard passes, the call reaches Binance's MCP server, which triggers Claude Code's standard tool approval prompt (the confirm-before-execute step), and the human sees the restated order.

4. **Legitimately distinct from existing work:**
   - **vs. acevod/trading-guardian:** Not advisory — hook blocks at runtime, not via LLM reasoning.
   - **vs. eikarna/binance-agent-mcp:** Validates trades *through* Binance Agent OS (the sanctioned path), not by reimplementing Binance's REST API as a parallel MCP server.

5. **Deployable in 7 days:** No OAuth registration, no public HTTPS endpoint, no MCP server boilerplate. Just a script that reads JSON on stdin and writes `hookSpecificOutput` on stdout.

---

## Hook Contract (Claude Code PreToolUse)

**Matcher:**
```json
{
  "PreToolUse": [
    {
      "matcher": "mcp__binance-mcp-server__.*",
      "command": "/home/iyke/coding/tradeguard/bin/validate-trade.js"
    }
  ]
}
```

**Input (stdin):**
```json
{
  "session_id": "...",
  "hook_event_name": "PreToolUse",
  "tool_name": "mcp__binance-mcp-server__place_order",
  "tool_input": {
    "symbol": "BTCUSDT",
    "side": "BUY",
    "type": "MARKET",
    "quantity": 0.01,
    "leverage": 10
  },
  "tool_use_id": "toolu_01...",
  "cwd": "/home/iyke/coding",
  "permission_mode": "default"
}
```

**Output (stdout, on violation):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Leverage 10x exceeds max allowed 5x (config: /home/iyke/coding/tradeguard/config/risk-rules.json)"
  }
}
```

**Exit code:**
- `0` + JSON above: tool call blocked, reason shown to Claude
- `0` + `permissionDecision: "allow"`: validation passed, tool proceeds
- `2`: hard block (overrides any JSON `"allow"`)

---

## Module Boundaries (SOLID)

```
/src
  /rules              Pure logic, zero I/O
    TradeRule.ts         interface: evaluate(trade, context): ValidationResult
    RuleEngine.ts        orchestrator: takes ProposedTrade + TradeRule[], returns ValidationResult
    MaxLeverageRule.ts
    MaxOrderSizeRule.ts
    PriceDeviationRule.ts
    SymbolWhitelistRule.ts
    VelocityLimitRule.ts  (nice-to-have tier)

  /interfaces         Dependency inversion
    MarketDataSource.ts   getLivePrice(symbol): Promise<number>
    AccountReader.ts      getBalance(): Promise<Balance>
    TradeExecutor.ts      submitTrade(trade): Promise<TradeResult>  (unused in hook path, here for Open/Closed)

  /binance            Typed wrapper implementing the interfaces above
    BinanceMcpClient.ts   connects via MCP, translates method calls to tool invocations

  /hook               Hook entry point
    validate-trade.js     reads stdin, instantiates RuleEngine + rules, writes hookSpecificOutput

  /config             Thresholds live here, not in code
    risk-rules.json      { maxLeverage: 5, maxOrderSizeUSDT: 1000, priceDeviationPct: 2.0, ... }
    risk-rules.schema.json

/tests
  /rules              Unit tests per rule, written alongside each rule
  /integration        Tests against real MCP connection (read-only calls only in CI)

/bin
  validate-trade.js     The hook script (chmod +x)

/.claude
  /hooks
    tradeguard.json     Hook registration (copied here during install)

ARCHITECTURE.md
README.md
package.json
```

### Single Responsibility Principle

- `RuleEngine`: one job — take a `ProposedTrade` and a list of `TradeRule`s, return a `ValidationResult`. Never imports from `/src/binance` or `/src/hook`.
- `BinanceMcpClient`: one job — translate typed method calls into MCP tool invocations. Contains zero rule logic.
- Each rule (`MaxLeverageRule`, `PriceDeviationRule`, etc.): one job — evaluate one dimension of risk.

### Open/Closed Principle

`RuleEngine.evaluate()` iterates over an injected array of `TradeRule`. Adding `VelocityLimitRule` later means adding one new file and one line in the config-driven rule list, never editing `RuleEngine` itself.

### Liskov Substitution Principle

Any concrete `TradeRule` must be fully swappable for any other in `RuleEngine`'s rule list with no special-casing. A test (`tests/rules/strategy-contract.test.ts`, mirroring AddressGuard's `strategy-contract.ts` pattern) runs `RuleEngine` against a fake rule that always passes and a fake rule that always fails, proving the engine treats every implementation identically.

### Interface Segregation Principle

- `MarketDataSource` (only `getLivePrice(symbol)`): used by `PriceDeviationRule`
- `AccountReader` (only `getBalance()`): used by `MaxOrderSizeRule` when checking "% of equity" thresholds
- `TradeExecutor` (only `submitTrade(trade)`): NOT used in the hook path (trades execute via the original MCP call after validation passes), but present for Open/Closed — a future CLI demo harness could submit trades directly

A rule that only needs price data must not depend on an interface that also exposes trade execution.

### Dependency Inversion Principle

`RuleEngine` and every `TradeRule` depend only on the interfaces above, never on `BinanceMcpClient` directly. This means the entire rule engine can be unit tested with in-memory fakes and zero network calls.

---

## Data Flow

1. **Agent proposes trade:** Claude calls `mcp__binance-mcp-server__place_order` with `{ symbol, side, quantity, leverage, ... }`
2. **Hook fires:** Claude Code's PreToolUse hook invokes `/home/iyke/coding/tradeguard/bin/validate-trade.js`, passing tool input as JSON on stdin
3. **RuleEngine evaluates:**
   - `validate-trade.js` parses stdin, loads `/config/risk-rules.json`
   - Instantiates `MaxLeverageRule`, `MaxOrderSizeRule`, `PriceDeviationRule`, `SymbolWhitelistRule`
   - `PriceDeviationRule` calls `BinanceMcpClient.getLivePrice(symbol)` (pulls live ticker via Binance MCP's market data scope, read-only, no auth needed if Market Data scope granted)
   - `RuleEngine` runs each rule, short-circuits on first violation
4. **Hook returns decision:**
   - **Violation found:** `permissionDecision: "deny"` + reason → Claude Code blocks the tool call, shows reason to Claude
   - **All rules pass:** `permissionDecision: "allow"` → tool call proceeds to Binance MCP server
5. **Binance's own confirmation:** If TradeGuard passed, Claude Code's standard tool approval prompt fires (the user sees the restated order and must confirm)
6. **Execution:** Only after both checks pass does the trade submit to Binance

---

## Real Binance MCP Tool Surface (Verified 2026-09-03)

Measured against a live authenticated session, not inferred from docs. `tools/list`
returns **50 tools**; sweeping every `tool_search` category and paginating reveals
**277 total**.

**Two-tier tool exposure.** The server keeps most tools hidden and reachable only
through a wrapper:

```
tool_execute { toolName: "spot.newOrder",
               arguments: { symbol, side, type, quantity, price? } }
```

A hook that reads only top-level `tool_input` sees `{toolName, arguments}` and no
`symbol` at all. The real trade parameters are one level down. `bin/validate-trade.js`
unwraps this in `unwrapBinanceCall()`.

**Order placement is spot-only under these scopes.** Granted scopes on the test
account: `mcp:account:read`, `mcp:spot:trade`, `mcp:margin:loan`,
`mcp:wallet:transfer`, `mcp:master:read`.

| Capability | Exposed? |
|---|---|
| `spot.newOrder`, `sorOrder`, `orderOco`, `orderList*` | yes |
| `margin.marginAccountNewOrder`, `NewOco`, `NewOto` | yes |
| `futures_usds.newOrder` / `futures_coin.newOrder` | **no** |
| `changeInitialLeverage` (any futures) | **no** |
| Futures reads (tickers, klines, positions, account) | yes |

The only leverage-adjacent tool present is `futures_usds.notionalAndLeverageBrackets`,
which is read-only. So `MaxLeverageRule` cannot fire from a real futures order on this
account — the futures write path does not exist to intercept. It still fires correctly
when leverage appears in an order payload, and would gate `futures_usds.newOrder` if a
`mcp:futures:trade` scope were granted. **For the demo, the live blocks are
SymbolWhitelistRule, MaxOrderSizeRule, and PriceDeviationRule against `spot.newOrder`.**

**Order placement must be an allowlist, not a keyword match.** `order` as a substring
appears in `queryOrder`, `allOrders`, `deleteOrder`, `getOpenOrders`, `orderAmendKeepPriority`
and dozens of other read/cancel tools. Matching `/order/i` treats every order lookup as
a trade proposal and denies it for having no symbol — which is exactly the failure seen
in the first live demo run. `isOrderPlacement()` uses an explicit prefix allowlist and
excludes `orderTest` / `sorOrderTest`, which validate without placing.

**Leverage is a separate call on Binance.** A futures `newOrder` payload carries no
`leverage` field; leverage is set beforehand via `changeInitialLeverage`. Market type is
therefore derived from the tool namespace (`futures_*` / `margin.` / `spot.`), never
from the presence of a leverage field.

---

## Rules (Core Tier — Must Ship)

### 1. MaxLeverageRule

**Input:** `ProposedTrade.leverage`  
**Threshold:** `config.maxLeverage` (e.g. `5`)  
**Violation:** `leverage > maxLeverage`  
**Reason:** `"Leverage {leverage}x exceeds max allowed {maxLeverage}x"`

### 2. MaxOrderSizeRule

**Input:** `ProposedTrade.quantity`, `ProposedTrade.symbol`  
**Threshold:** `config.maxOrderSizeUSDT` (e.g. `1000`)  
**Depends on:** `MarketDataSource.getLivePrice(symbol)` to convert quantity → notional USDT  
**Violation:** `notional > maxOrderSizeUSDT`  
**Reason:** `"Order size {notional} USDT exceeds max allowed {maxOrderSizeUSDT} USDT"`

*Alternative threshold (ask user):* `config.maxOrderSizePctEquity` (e.g. `10` = 10% of account equity). Requires `AccountReader.getBalance()` to pull current equity.

### 3. PriceDeviationRule — The Differentiator

**Why this rule matters:**

This is TradeGuard's primary defensible angle against competitors. It catches *the agent's own stale or hallucinated prices* before they reach execution. If Claude's reasoning references "current BTCUSDT is $95,000" (from cached context, a stale web search, or outright hallucination) but live market shows $68,000, this rule blocks the trade **before the human sees it** in Binance's confirmation prompt.

Neither `acevod/trading-guardian` (advisory-only Skill) nor `tokyoville741/guardrail-desk` (basic Python script) implements this check. They validate leverage and size but trust whatever price the agent proposes. `eikarna/binance-agent-mcp` has a price-collar rule but measures slippage (order price vs live bid/ask spread), not deviation from live mid-market — different failure mode.

**Input sources:**

1. **Market orders:** Agent typically doesn't specify a price (execution at market), but may reference an assumed "current price" in its reasoning or description field. This rule doesn't block market orders on price alone (there's no proposed price to compare), but if the agent later checks "did that fill at $X?" against a hallucinated price, the next trade informed by that false belief gets caught.

2. **Limit orders:** Agent specifies `ProposedTrade.price`. This is the direct comparison target.

3. **Stop/stop-limit orders:** Agent specifies `stopPrice` and optionally `price`. Both are checked.

**Comparison source:**

`MarketDataSource.getLivePrice(symbol)` pulls the **live 24h ticker** from Binance MCP's Market Data scope (read-only, no auth required if scope granted). Specifically, the `lastPrice` field from the ticker, which represents the most recent trade price on the exchange — the canonical "live market price" both humans and the agent should be reasoning from.

**Deviation calculation:**

```
deviation_pct = abs((proposed_price - live_price) / live_price) * 100
```

**Threshold:** `config.maxPriceDeviationPct = 2.0` (2%)

**Rationale for 2.0%:**

Measured against live Binance klines on 2026-09-03 (true range as % of close, across the three whitelisted symbols):

| symbol | timeframe | median | p90 | p99 | max |
|---|---|---|---|---|---|
| BTCUSDT | 1m | 0.047% | 0.104% | 0.200% | 0.369% |
| BTCUSDT | 5m | 0.132% | 0.266% | 0.480% | 0.893% |
| BTCUSDT | 15m | 0.198% | 0.428% | 0.716% | 1.002% |
| ETHUSDT | 1m | 0.067% | 0.137% | 0.281% | 0.613% |
| ETHUSDT | 5m | 0.171% | 0.356% | 0.730% | 1.453% |
| ETHUSDT | 15m | 0.250% | 0.554% | 1.259% | 1.777% |
| BNBUSDT | 1m | 0.041% | 0.084% | 0.150% | 0.259% |
| BNBUSDT | 5m | 0.111% | 0.219% | 0.439% | 0.701% |
| BNBUSDT | 15m | 0.176% | 0.354% | 0.720% | 1.033% |

(1000 candles for 1m/5m, 500 for 15m. Reproduce with `/api/v3/klines`.)

The worst single 15-minute candle in the sample moved 1.78% (ETHUSDT); every 1-minute candle stayed under 0.62%. So 2.0% sits above the entire measured distribution — including the tail — with the tightest margin on ETHUSDT 15m (1.78% vs the 2.0% ceiling, ~0.2pp of headroom).

What that means in practice:
- A limit order placed off a price fetched seconds ago passes comfortably; p99 1-minute range is under 0.3% on all three symbols.
- A price cached 15+ minutes ago during a fast move can exceed 2% and gets denied — which is the intended catch.
- Outright hallucinations (10%+ off market) are denied by a wide margin.

**Caveat on the sample:** these are calm-market numbers. During macro releases or liquidation cascades, 15-minute ranges on ETH have historically reached 3–5%, which would push legitimate limit orders past a 2% ceiling. The measurement above does not cover such a window. If false positives show up in volatile sessions, raise `maxPriceDeviationPct` or set a per-symbol override for ETHUSDT — ETH is the binding constraint of the three, and BNBUSDT has the most headroom (max 1.03%).

**Tunable per-symbol:** Config supports `symbolSpecificDeviations: { "BTCUSDT": 2.0, "SOLUSDT": 3.5 }` for higher-vol pairs. Not implemented in core tier, noted as enhancement.

**Edge case — rapid price movement:**

If live price moves 2.5% *during* the validation window (agent proposes trade at T, hook fetches live price at T+200ms, market moved in that window), the rule may false-positive. Mitigation: accept this as a feature, not a bug — if the market is moving that fast, pausing for human review is correct behavior. The user sees the denial reason, checks current price, and resubmits if still desired.

**Violation message format:**

```
"Proposed price $68,234.50 deviates 3.2% from live market $66,123.00 (max allowed 2.0%). 
Live price fetched from Binance ticker at 2026-09-02T14:32:18Z. 
If market moved, retry with current price."
```

Includes timestamp of live price fetch so the user knows how recent the "live" comparison was.

**Failure modes this rule defends against:**

1. **Context caching:** Agent's last market data is from 20 minutes ago (still in prompt cache), proposes trade at stale price.
2. **Hallucination:** Agent fabricates a plausible-sounding price ($67,500 when real is $63,800).
3. **Unit confusion:** Agent quotes price in wrong denomination (e.g. satoshis vs BTC, or reads EUR ticker as USD).
4. **Typo in agent's reasoning:** Agent reads $68,234 as $86,234 in a prior tool result and uses the wrong figure.

**Not defended (out of scope):**

- Front-running / sandwich attacks (off-chain MEV, not applicable to CEX)
- Oracle manipulation (Binance's ticker is the canonical source)
- Slippage on large orders (agent should use limit orders; market order slippage is user's acceptance of execution risk)

**Testing approach:**

Unit test with mocked `MarketDataSource`:
```typescript
const mockMarket = { getLivePrice: async () => 50000.0 }; // Live BTC = $50k
const rule = new PriceDeviationRule(2.0, mockMarket);

// 1% deviation → pass
expect(rule.evaluate({ symbol: 'BTCUSDT', price: 50500 })).toEqual({ passed: true });

// 3% deviation → fail
expect(rule.evaluate({ symbol: 'BTCUSDT', price: 51500 })).toEqual({ 
  passed: false, 
  reason: expect.stringContaining('deviates 3.0%') 
});
```

Integration test against real Binance MCP connection (Market Data scope, read-only):
```bash
# Fetch live BTCUSDT, propose trade at live + 5%, confirm hook denies
LIVE=$(curl -s 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT' | jq -r '.lastPrice')
INFLATED=$(echo "$LIVE * 1.05" | bc)
node bin/validate-trade.js <<EOF
{"tool_name":"mcp__binance-mcp-server__place_order","tool_input":{"symbol":"BTCUSDT","price":$INFLATED,"side":"BUY","quantity":0.001}}
EOF
# Expect: permissionDecision: "deny", reason includes "deviates 5.0%"
```

### 4. SymbolWhitelistRule

**Input:** `ProposedTrade.symbol`  
**Threshold:** `config.allowedSymbols` (array, e.g. `["BTCUSDT", "ETHUSDT", "BNBUSDT"]`)  
**Violation:** `!allowedSymbols.includes(symbol)`  
**Reason:** `"Symbol {symbol} not in whitelist"`

---

## Rules (Nice-to-Have Tier — Only If Time Remains)

### 5. VelocityLimitRule

**Input:** Recent trade history (requires state storage — JSON file or in-memory cache per session)  
**Thresholds:**
- `config.maxTradesPerHour` (e.g. `10`)
- `config.maxDrawdownUSDT` (e.g. `500` = auto-pause after cumulative $500 loss in 24h)

**Violation:**
- Trade count in last 60 minutes > `maxTradesPerHour`
- OR cumulative loss in last 24h > `maxDrawdownUSDT`

**Reason:** `"Trade velocity {count} trades/hour exceeds limit {maxTradesPerHour}"` OR `"Cumulative 24h loss {loss} USDT exceeds drawdown limit {maxDrawdownUSDT} USDT"`

**Pattern source:** BNB Chain hackathon "Guarded Alpha" winner used similar circuit-breaker logic.

**Hard checkpoint:** If time runs out before this ships, stop and ship rules 1–4 as-is. A fully working narrow core beats an ambitious half-wired extra rule.

---

## Ambiguities Requiring User Input

**Before finalizing this architecture, the following must be clarified:**

1. **MaxLeverageRule threshold:** What numeric max? (Competitor uses ≤3x simple, 4-10x light, >10x full. Suggest `5` as default — reasonable for demo, strict enough to trigger on common risky proposals.)

2. **MaxOrderSizeRule mode:** Absolute USDT cap, or % of equity, or both?
   - Absolute: simpler, no Account scope dependency, demo-friendly
   - % of equity: more realistic, requires Account scope + `getBalance()` call
   - **Recommendation:** Start with absolute USDT cap (`1000 USDT`), add % of equity as nice-to-have

3. **PriceDeviationRule threshold:** What % deviation is "implausibly far"? (Suggest `2.0%` = 2% deviation max — tight enough to catch stale data, loose enough for volatile crypto pairs.)

4. **SymbolWhitelistRule:** Which symbols to allow? (Suggest `["BTCUSDT", "ETHUSDT", "BNBUSDT"]` for demo — major pairs, liquid, low chance of typo/hallucination.)

5. **Futures products:** USDⓈ-M only, or also COIN-M? (Docs state both are supported. Suggest USDⓈ-M only for core tier — simpler, more commonly used.)

6. **Spot, Margin, Convert:** In scope for rule validation, or futures-only? (Docs state all are supported. Suggest futures + spot for core tier, margin/convert nice-to-have.)

---

## Implementation Checkpoints

**Phase 1 (this document):** Architecture review and ambiguity resolution → **STOP HERE until user confirms**

**Phase 2 (after approval):**
1. Interfaces + `RuleEngine` against fakes, fully unit tested
2. Individual rules (1–4 above), each written and tested against fakes before moving to next
3. `BinanceMcpClient` — implement read-only calls (`getLivePrice`, `getBalance`) against real connected sub-account, confirmed working before touching write operations
4. Hook script (`validate-trade.js`) — wire RuleEngine + rules, read stdin, write hookSpecificOutput
5. End-to-end demo: one deliberately bad trade (e.g. leverage above max) blocked with clear reason, one good trade passes validation and reaches Binance's confirm step
6. (Nice-to-have) `VelocityLimitRule` — only if time remains and steps 1–5 are fully working

**If time runs out before step 6 starts, stop and ship steps 1–5 as-is.**

---

## Deliverable Honesty (README.md)

State plainly:
- **What this does:** Blocks agent-proposed Binance trades that violate user-set risk rules before they reach Binance's own confirmation step.
- **What it does not do, and why:** No external-address risk screening (not applicable — Binance Agent OS has no withdrawal scope by design), no strategy generation, no backtesting, no multi-exchange support.
- **Interception path:** PreToolUse hook on `mcp__binance-mcp-server__*` tools (harness-layer enforcement).
- **Phase 0.5 competitive finding:** One direct overlap (`acevod/trading-guardian-binance-agent-os`, Claude Skill, advisory-only). TradeGuard differentiates via deterministic enforcement + price-deviation rule.
- **Limitation:** Phase 0.5 check has no official registry — other entries may exist unpublished.

---

## Open Questions for User

Before proceeding to implementation:

1. Confirm interception path (PreToolUse hook) is acceptable, or prefer Skill-based (Path B)?
2. Clarify numeric thresholds (leverage, order size, price deviation) — use suggested defaults or set custom?
3. Clarify product scope (USDⓈ-M futures only, or also spot/margin/COIN-M)?
4. Clarify symbol whitelist for demo
5. Should `MaxOrderSizeRule` check absolute USDT cap, % of equity, or both?

**Next step:** Review this architecture, answer open questions, then proceed to implementation (Phase 2).
