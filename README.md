# TradeGuard

**Pre-flight validator for Binance Agent OS MCP server**

Blocks agent-proposed trades violating user-defined risk rules *before* they reach Binance's own confirmation step. Two independent checks, not one replacing the other.

**Binance Agent OS Mini Hackathon — Track A: Trading Workflows**

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

## PriceDeviationRule

Leverage and size caps check the agent's intent. This rule checks whether the agent's
*view of the market* is still true.

If the agent proposes a limit order at $95,000 — from context cached twenty minutes ago,
a stale web result, or a hallucination — while the live market is at $68,000, the order
is denied before it reaches Binance's confirmation step. The rule fetches the current
price at validation time and compares; it does not trust the price in the payload.

The 2% default sits above measured intraday true range for all three whitelisted symbols
(1-minute p99 under 0.3%; worst 15-minute candle 1.78% on ETHUSDT). See
[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) for the measurements and the
caveat about volatile sessions.

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

Hooks are registered in `settings.json` — either `~/.claude/settings.json` (all projects) or `.claude/settings.json` (one project). Add the `hooks` block, keeping any existing keys in the file:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__binance-mcp-server__.*",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/tradeguard/bin/validate-trade.js"
          }
        ]
      }
    ]
  }
}
```

The nested `hooks` array inside the matcher is required — a flat `{ matcher, command }` object is silently ignored.

**Using multiple Claude Code profiles?** Each `CLAUDE_CONFIG_DIR` is a separate config root, so register the hook in every profile you use (e.g. `~/.claude-b/settings.json`, `~/.claude-c/settings.json`).

---

## Fund the Agentic Sub-Account

The agent cannot move funds into its own sub-account — that transfer is always manual, via the Binance web UI:

```
https://www.binance.com/en/my/sub-account/asset-management/transfer?asset=BTC
```

Funding is only needed for orders that actually execute. Rule denials happen before the order reaches Binance, so they work on an empty sub-account.

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
│   ├── risk-rules.json     # User-editable thresholds
│   └── risk-rules.schema.json
├── docs/architecture/      # ARCHITECTURE.md, API.md, DEVELOPMENT.md
├── CONTRIBUTING.md
└── README.md
```

The PreToolUse hook is registered in your own `settings.json` — see
[Mode 2 Setup](#mode-2-setup-claude-code-hook-claude-code-only) for the block to add.

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

| File | Description |
|------|-------------|
| [README.md](README.md) | Installation and setup (this file) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines, PR process |
| [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | Full design, SOLID principles, data flow |
| [docs/architecture/API.md](docs/architecture/API.md) | Complete API reference with examples |
| [docs/architecture/DEVELOPMENT.md](docs/architecture/DEVELOPMENT.md) | Dev guide, troubleshooting, rule checklist |

---

## Limitations (By Design)

- **Spot orders only, under the scopes Binance currently grants.** Futures order placement and `changeInitialLeverage` are not exposed by the Binance MCP server for `mcp:spot:trade` / `mcp:account:read` / `mcp:margin:loan` / `mcp:wallet:transfer` / `mcp:master:read`. `MaxLeverageRule` gates any order payload carrying a leverage field, but no such payload can be produced on an account without a futures trade scope. See [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) for the verified tool surface.
- **Bearer token management.** MCP proxy mode takes the token via `BINANCE_TOKEN` and does not refresh it. Tokens expire; re-authenticate and restart the server.
- **No velocity or drawdown rule.** Rate limiting across trades and cumulative-loss circuit breaking are not implemented.

---

## License

MIT — see `LICENSE` file.

---

## Repository

https://github.com/devIykee/tradeguard

Built for the Binance Agent OS Mini Hackathon (Track A — Trading Workflows).
