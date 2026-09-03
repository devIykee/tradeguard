# Session Handoff Prompts

Two prompts for a fresh Claude Code session. Use whichever fits.

---

## Answering the question directly

`/clear` **wipes conversation history** — nothing you said before it survives. There's no
"clear the screen but keep what I told you." What *does* survive a `/clear` is anything
loaded from a file at session start: `CLAUDE.md`, `.claude/rules/`, and imports.

So the reliable pattern is not "brief it, then clear." It's:

1. Put the durable context in a file (already done — see `Prompt B` below).
2. Start the session, paste the primer, and just **keep going in the same session**.

If you genuinely want a clean transcript before recording, put the context in `CLAUDE.md`
in the directory you launch from. Then `/clear` costs you nothing — the file reloads.

`/compact` is the other option: it summarizes instead of discarding, so earlier context
survives in compressed form. Better than `/clear` if you want a shorter transcript
without losing the briefing.

---

## Prompt A — Full context primer

Paste this as the first message of a new session in `/home/iyke/coding/tradeguard`.

```
I'm working on TradeGuard, my submission for the Binance Agent OS Mini Hackathon
(Track A, Trading Workflows, deadline 2026-09-08 23:59 UTC).

Repo: /home/iyke/coding/tradeguard — git remote git@github.com:devIykee/tradeguard.git,
branch main, clean at commit 469b6ae. Read README.md and docs/architecture/ARCHITECTURE.md
before changing anything.

WHAT IT IS
A pre-flight validator that blocks agent-proposed Binance trades violating risk rules
before they reach Binance's own confirmation step. Two deployment modes:
  1. MCP proxy server (bin/start-server.js) — agent-agnostic, works with OpenClaw etc.
  2. Claude Code PreToolUse hook (bin/validate-trade.js) — Claude Code only

Four rules in src/rules/, thresholds in config/risk-rules.json (never hardcoded):
maxLeverage 5, maxOrderSizeUSDT 1000, maxPriceDeviationPct 2.0,
allowedSymbols BTCUSDT/ETHUSDT/BNBUSDT. 61 unit tests, all passing.

The differentiator is PriceDeviationRule — it fetches live price from Binance and
blocks trades whose proposed price deviates >2%, catching the agent's own stale or
hallucinated prices. Verified against real klines: 1m p99 under 0.3% on all three
symbols, worst 15m candle 1.78% (ETHUSDT), so 2% clears the measured distribution.
ETHUSDT is the binding constraint if I ever need a per-symbol override.

MY ENVIRONMENT — read this carefully, it has bitten us before
I run three Claude Code profiles via CLAUDE_CONFIG_DIR, defined as bash functions in
~/.bashrc: `claude` (~/.claude), `claude-b` (~/.claude-b), `claude-c` (~/.claude-c).
Each is a SEPARATE config root — its own settings.json, its own .claude.json where MCP
servers live, its own .credentials.json where OAuth tokens live. Nothing is shared
between them. When you change config, ask which profile I mean, or change all three.

Hooks go in settings.json, NOT in a hooks/ directory, and the schema needs a nested
hooks array inside each matcher:
  { "matcher": "...", "hooks": [{ "type": "command", "command": "..." }] }
A flat { matcher, command } object is silently ignored. I lost time to exactly this.

The TradeGuard hook and binance-mcp-server are already registered in all three profiles.

WHAT'S DONE
Code complete, tests passing, docs organized under docs/, everything pushed.

WHAT'S LEFT
1. Binance OAuth login — no profile has a token yet. Need /mcp → binance-mcp-server →
   browser login, in whichever profile I record from.
2. Record the demo video (script in docs/guides/DEMO_VIDEO_GUIDE.md).
3. Post to X, fill the submission form (answers in
   docs/submission/HACKATHON_FORM_ANSWERS.md).

HOW I WANT YOU TO WORK
Verify before claiming. If you cite a number, measure it — don't estimate and present
it as fact. Read files before describing them. Say plainly when something is unverified.
Don't add features I didn't ask for. Keep responses short.

Confirm you've read the repo, then wait for my next instruction.
```

---

## Prompt B — Recording session (demo project)

Launch from `/home/iyke/demo-project` using the **claude-c** profile:

```bash
claude-c
```

`CLAUDE.md` there loads automatically, survives `/clear`, and tells Claude to skip
deliberation and call tools directly. No primer needed.

Confirm it loaded: run `/context` and look under **Memory files**.

### Demo prompts, in order

```
Buy 100 DOGE at market on Binance spot
```
→ denied: `Symbol "DOGEUSDT" not in whitelist. Allowed: btcusdt, ethusdt, bnbusdt`

```
Buy 1 BTC at market on Binance spot
```
→ denied: `Order size 77718.91 USDT exceeds max allowed 1000.00 USDT`

```
What is the current BTCUSDT price?
```
→ answers normally (reads pass through untouched)

```
Place a limit buy for 0.001 BTC at $200,000
```
→ denied: `Proposed price $200000.00 deviates 157.40% from live market $77700.86`
**This is the differentiator — hold on it.**

```
Buy 0.0001 BTC at market on Binance spot
```
→ passes TradeGuard, reaches Binance's own confirmation. Decline when asked.

### On the 10x leverage prompt

Don't use it. Futures order placement and `changeInitialLeverage` are **not exposed**
by the Binance MCP server under the granted scopes (`spot:trade`, `account:read`,
`margin:loan`, `wallet:transfer`, `master:read`) — only spot writes exist. The request
can't reach a futures endpoint, so the denial you see would be a scope limitation, not
TradeGuard working.

The three spot blocks above are all real TradeGuard denials against `spot.newOrder`.
Use those.
