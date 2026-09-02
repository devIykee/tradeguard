# Phase 0.5 — Competitive Check (Best-Effort)

## Limitation

The Binance Agent OS Mini Hackathon has no official registry, leaderboard, or queryable API. Entries are posted as Twitter/X replies or quote-reposts to Binance's announcement. This check searches GitHub and web for public submissions but **cannot claim completeness** — other entries may exist that aren't indexed yet or are published elsewhere.

## Search Method

- GitHub code search: `"Binance Agent OS"`, `binance-mcp-server`, `agent.binance.com/mcp/agentic`, `pre-trade validation`, `guardrail`, `risk rules`
- GitHub repo search: same terms + `track A`, `trading workflows`
- Web search via DuckDuckGo: `"Binance Agent OS Mini Hackathon"`
- Search date: 2026-09-02

## Direct Overlaps Found

### 1. acevod/trading-guardian-binance-agent-os

- **Created:** 2026-08-29 (4 days before this prompt)
- **Type:** Claude Skill (markdown + references, no code)
- **Approach:** Risk-aware trading copilot — **informs and challenges, does not block**
- **Philosophy:** "Challenge the trade, don't block the user."
- **Workflow:** Challenge → Inform → Confirm → Execute → Verify
- **Thresholds:** 
  - Position size vs equity: <5% simple, 5-15% light, >15% full guardian
  - Leverage: ≤3x simple, 4-10x light, >10x full (always flag as high-risk)
  - Funding rate: -0.03% to 0.03% normal, ±0.1% elevated, >±0.1% extreme
  - Concentration: single asset >40%, correlated group >60%
  - Momentum: 24h move >±7% in same direction as trade = "chasing momentum"
- **Enforcement:** LLM reasoning layer only — Claude is instructed to follow the workflow, but can silently misapply thresholds or skip steps
- **Distinctive elements:** Devil's Advocate + Bull Case + Guardian Verdict format, tiered analysis depth

**TradeGuard differentiator:** Deterministic rule engine with hard blocks (not advisory), price-deviation rule that catches the agent's own stale/hallucinated prices (not covered by trading-guardian), harness-layer enforcement via PreToolUse hook (cannot be bypassed by LLM reasoning).

### 2. tokyoville741-debug/guardrail-desk

- **Created:** 2026-09-01
- **Type:** Python script (2.1 KB) + system prompt
- **Rules:** Max 50 USDT per order, max 24h change ±8%, human confirmation required
- **Enforcement:** Advisory only — returns "GO" or "NO-GO" plus reasons, no actual blocking mechanism
- **Scope:** Minimal — proof-of-concept level

**TradeGuard differentiator:** Full rule engine, config-driven thresholds, executable enforcement, broader rule set (leverage, price deviation, symbol whitelist, velocity limits).

### 3. eikarna/binance-agent-mcp

- **Created:** 2026-09-02 (today)
- **Type:** TypeScript MCP server (alternative implementation, not a proxy)
- **Approach:** "Production-grade" pre-trade policy engine + circuit breaker, connects directly to Binance REST API (not Agent OS)
- **Features:**
  - Notional USD caps per transaction + 24h drawdown limits
  - Price collar (max slippage %)
  - Duplicate order detection (idempotency via EIP-712 signed intents)
  - Rate-limit sentinel (tracks `X-MBX-USED-WEIGHT-1M` header)
  - Zero-float precision (BigInt throughout)
- **Scope:** Builds its own MCP server that wraps Binance's REST API, not a validator sitting between Agent OS and the agent

**TradeGuard differentiator:** Validates trades proposed *through* Binance's Agent OS MCP server (the sanctioned integration path) rather than reimplementing Binance's API. Focuses on the narrow gap between agent proposal and Binance's confirm step, not on building a parallel trading stack.

## Other Repos Mentioning Binance Agent OS (Not Direct Overlaps)

- **HKUDS/Vibe-Trading:** Backtesting framework (unrelated to live trading guardrails)
- **waldefran/ValdeAgent:** TypeScript, created 2026-09-01, no description, minimal activity
- **Binance/binance-skills-hub:** Official skills hub (read-only + agentic wallet, not pre-trade validation)
- **Various news digests / agent radars:** Mention Binance Agent OS but no competing implementations

## Web Search Results

DuckDuckGo search for `"Binance Agent OS Mini Hackathon"` returned no indexed writeups, blog posts, or public submission threads as of 2026-09-02. This suggests the competition is early-stage or entries aren't yet widely published.

## Conclusion

**One direct overlap exists:** `acevod/trading-guardian-binance-agent-os` (Claude Skill, advisory-only, no price-deviation check).

**TradeGuard's narrow, defensible angle:**
1. Deterministic enforcement at harness layer (PreToolUse hook) — LLM cannot bypass
2. Price-deviation rule — catches agent's own stale/hallucinated prices before they reach Binance
3. Config-driven, testable, SOLID-compliant rule engine — not just a system prompt

**The space is not crowded.** Most repos either (a) build alternative MCP servers, (b) provide advisory-only prompts, or (c) focus on unrelated use cases like backtesting or on-chain DeFi.
