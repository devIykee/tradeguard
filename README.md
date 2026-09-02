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

## Architecture: Two Deployment Modes

TradeGuard works with **any MCP-compatible agent** — not just Claude Code. Pick the mode that fits your setup:

### Mode 1: MCP Proxy Server (Agent-Agnostic) ✅ RECOMMENDED

TradeGuard runs as a standalone MCP server that proxies Binance's MCP endpoint. Works with **any agent**: Claude Code, OpenClaw, custom agents, or any MCP client.

**Flow:**  
Agent → TradeGuard MCP Server (validates) → Binance MCP (executes)

**Why this mode:**
- ✅ **Agent-agnostic** — works with Claude Code, OpenClaw, custom agents
- ✅ Deterministic enforcement — agent cannot bypass via reasoning
- ✅ Two independent checks: TradeGuard validates → Binance's confirm-before-execute prompt
- ✅ Standard MCP protocol — no custom integrations needed

### Mode 2: Claude Code Hook (Claude-Only)

TradeGuard runs as a PreToolUse hook inside Claude Code's harness.

**Flow:**  
Claude Code → PreToolUse hook (validates) → Binance MCP (executes)

**Why this mode:**
- ✅ Zero-config deployment (just copy hook JSON)
- ✅ No bearer token management required
- ❌ **Claude Code only** — doesn't work with OpenClaw or other agents

---

## Installation

### Prerequisites

- Node.js 22+
- Binance account with Agentic sub-account
- **Mode 1 (any agent):** Bearer token from Binance OAuth
- **Mode 2 (hook):** Claude Code CLI

### 1. Clone and build

```bash
git clone https://github.com/devIykee/tradeguard.git
cd tradeguard
npm install
npm run build
```

---

## Mode 1 Setup: MCP Proxy Server (Works with OpenClaw, Claude Code, Any Agent)

### Step 1: Authenticate with Binance and get your token

Connect to Binance Agent OS from any agent or browser:

```
https://agent.binance.com/mcp/agentic
```

Complete the OAuth flow. Then open **browser dev tools → Network tab**, find a request to `agent.binance.com`, and copy the `Authorization: Bearer <token>` header value.

### Step 2: Start TradeGuard as an MCP server

```bash
BINANCE_TOKEN=your_bearer_token node bin/start-server.js
```

Leave this running in a terminal. TradeGuard will log "Ready to validate Binance trades".

### Step 3: Point your agent at TradeGuard

**Claude Code:**
```bash
claude mcp add tradeguard stdio node /absolute/path/to/tradeguard/bin/start-server.js
```
Set `BINANCE_TOKEN` in your environment before starting Claude Code:
```bash
export BINANCE_TOKEN=your_bearer_token
claude
```

**OpenClaw (Telegram):**
In OpenClaw's MCP server settings, add a custom stdio server:
```json
{
  "command": "node",
  "args": ["/absolute/path/to/tradeguard/bin/start-server.js"],
  "env": { "BINANCE_TOKEN": "your_bearer_token" }
}
```

**Any other MCP-compatible agent:**
```json
{
  "mcpServers": {
    "tradeguard": {
      "command": "node",
      "args": ["/absolute/path/to/tradeguard/bin/start-server.js"],
      "env": { "BINANCE_TOKEN": "your_bearer_token" }
    }
  }
}
```

TradeGuard exposes the **same tools as the Binance MCP server** — your agent doesn't change how it calls tools. TradeGuard validates, then forwards passing calls to Binance automatically.

---

## Mode 2 Setup: Claude Code Hook (Claude Code Only)

### Step 1: Connect Binance MCP server directly

```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
```

Follow the browser OAuth flow. Grant scopes: Market data + Account + Trade.

### Step 2: Install TradeGuard hook

```bash
# In your Claude Code project directory:
mkdir -p .claude/hooks
cp /path/to/tradeguard/.claude/hooks/tradeguard.json .claude/hooks/
```

Edit `.claude/hooks/tradeguard.json` — update the `command` to the absolute path of `tradeguard/bin/validate-trade.js`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "mcp__binance-mcp-server__.*",
      "command": "/absolute/path/to/tradeguard/bin/validate-trade.js"
    }]
  }
}
```

---

## Fund Agentic Sub-Account (Optional for Demo)

Transfer funds manually via Binance web UI:

```
https://www.binance.com/en/my/sub-account/asset-management/transfer?asset=BTC
```

**Not required for demo** — all blocked scenarios work with zero funds. Only needed if you want to show one passing trade executing.

---

## Customize Risk Rules (Both Modes)

Edit `config/risk-rules.json` — thresholds live here, never in code:

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

### Scenario 1: Excessive Leverage (blocked)

In your agent:

```
Open a 10x leveraged long position on BTCUSDT, 0.01 BTC
```

**Expected:**  
❌ TradeGuard blocks with "Leverage 10x exceeds max allowed 5x"

---

### Scenario 2: Symbol Not in Whitelist (blocked)

```
Buy 100 DOGE at market on Binance spot
```

**Expected:**  
❌ TradeGuard blocks with "Symbol 'DOGEUSDT' not in whitelist. Allowed: btcusdt, ethusdt, bnbusdt"

---

### Scenario 3: Price Deviation — THE KEY FEATURE (blocked)

```
Check current BTCUSDT price, then place a limit buy for 0.01 BTC at a price 10% above market
```

**Expected:**  
❌ TradeGuard blocks with "Proposed price $71,500 deviates 10.0% from live market $65,000 (max allowed 2.0%)"

**This is the differentiator** — catches stale or hallucinated prices that other validators miss.

---

### Scenario 4: Valid Trade (passes validation)

```
Buy 0.001 BTC at market on Binance spot
```

**Expected:**  
✅ TradeGuard validation passes  
✅ Trade proceeds to Binance's confirm-before-execute prompt  
✅ Human reviews and confirms  
✅ Trade executes

---

## Testing

Run the test suite:

```bash
npm test
```

**61 tests passing:**
- Contract test suite (Liskov Substitution Principle enforced)
- Per-rule unit tests (all rules tested against fakes, zero network calls)
- Integration tests (validation flow end-to-end)

---

## Project Structure

```
tradeguard/
├── src/
│   ├── rules/              # RuleEngine + 4 rules (pure logic, zero I/O)
│   ├── interfaces/         # Dependency inversion (MarketDataSource, etc.)
│   ├── binance/            # BinanceMcpHttpClient (implements interfaces)
│   ├── server/             # TradeGuardServer (MCP proxy mode)
│   └── config/             # risk-rules-loader (Zod validation)
├── bin/
│   ├── validate-trade.js   # Hook entry point (Mode 2)
│   └── start-server.js     # MCP server entry point (Mode 1)
├── tests/unit/             # 61 tests, contract suite + per-rule tests
├── config/
│   └── risk-rules.json     # User-editable thresholds
├── .claude/hooks/
│   └── tradeguard.json     # Hook registration (copy to your project)
├── ARCHITECTURE.md
├── PHASE_0_FINDINGS.md
├── PHASE_0.5_COMPETITIVE.md
└── README.md
```

---

## SOLID Principles

TradeGuard follows SOLID principles strictly:

- **Single Responsibility**: `RuleEngine` evaluates rules only. `BinanceMcpHttpClient` translates MCP calls only.
- **Open/Closed**: Adding a new rule means adding one file, zero edits to `RuleEngine`.
- **Liskov Substitution**: Any `TradeRule` is fully swappable (contract test suite proves this).
- **Interface Segregation**: `MarketDataSource`, `AccountReader`, `TradeExecutor` are separate interfaces.
- **Dependency Inversion**: Rules depend on interfaces, never concrete implementations.

See `ARCHITECTURE.md` for full breakdown.

---

## Documentation

- **README.md** (this file) — Installation, demo scenarios
- **ARCHITECTURE.md** — Full design with SOLID principles, data flow
- **DEVELOPMENT.md** — Dev guide, troubleshooting, rule implementation checklist
- **API.md** — Complete API reference with examples
- **CONTRIBUTING.md** — Contribution guidelines, PR process
- **SUBMISSION_CHECKLIST.md** — Hackathon submission guide with video script
- **PHASE_0_FINDINGS.md** — Documentation verification report
- **PHASE_0.5_COMPETITIVE.md** — Competitive analysis

Total: **4,730+ lines** of documentation.

---

## Limitations (By Design)

- **MCP tool names unconfirmed**: Hook/proxy matches `.*order.*|.*trade.*` as fallback — tool names may vary
- **Bearer token management**: Mode 1 requires manual token extraction (OAuth spec doesn't provide programmatic refresh)
- **No VelocityLimitRule**: Nice-to-have feature deferred (7-day hackathon window)

---

## License

MIT — see `LICENSE` file.

---

## Submission

**Binance Agent OS Mini Hackathon — Track A: Trading Workflows**

- **GitHub**: https://github.com/devIykee/tradeguard
- **Video**: [Coming soon]
- **Deadline**: 2026-09-08 23:59 UTC

Built by deviykee (eokorie1911@gmail.com)
