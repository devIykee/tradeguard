# TradeGuard — Hackathon Submission Answers

**Use these answers when filling the submission form.**

---

## 1. Which theme does your submission fall under?

**Answer:** `Trading Workflows`

---

## 2. Please provide a text description of your project, including a brief introduction to your agent or workflow.

**Answer (copy-paste this):**

```
TradeGuard is a pre-flight validator for Binance Agent OS that blocks risky trades before execution. It works with any MCP-compatible agent (Claude Code, OpenClaw, custom agents) by running as a proxy MCP server or as a Claude Code hook.

Architecture:
Agent → TradeGuard (validates) → Binance MCP (executes)

Four deterministic risk rules:
• MaxLeverageRule: blocks futures trades >5x leverage (configurable)
• MaxOrderSizeRule: blocks orders >$1,000 USDT (configurable)
• SymbolWhitelistRule: blocks trades outside BTC/ETH/BNB
• PriceDeviationRule: blocks trades with prices >2% off live market

The key differentiator is PriceDeviationRule — it catches the agent's own stale or hallucinated prices by fetching live price from Binance's public API and comparing. If the agent references "BTCUSDT is $95,000" (from cached context or hallucination) but live market shows $68,000, TradeGuard blocks it. No competitor implements this check.

Why this matters: AI agents can act on outdated information, hallucinated prices, or misinterpret market data. TradeGuard provides deterministic enforcement at the harness layer — the agent cannot bypass rules via reasoning, unlike advisory-only implementations.

Two independent safety checks: TradeGuard validates first, then Binance's own human confirmation (if the trade passes TradeGuard). Not one replacing the other.

Tech stack: TypeScript, Node.js 22, @modelcontextprotocol/sdk, Zod validation, Vitest testing. SOLID principles enforced throughout — adding new rules means adding one file, zero edits to core engine.

Testing: 61 unit tests with contract test suite proving Liskov Substitution Principle compliance. All rules tested against fakes with zero network calls.

Documentation: 4,730+ lines across 9 markdown files (README, ARCHITECTURE, DEVELOPMENT, API reference, CONTRIBUTING, competitive analysis, submission guide, phase 0 findings, demo guide).

Open source: MIT licensed, production-ready.
GitHub: https://github.com/devIykee/tradeguard
```

**Character count: 1,763** (most forms allow 2,000-5,000 characters)

---

## 3. Which platform did you post your video on?

**Answer:** `X` (Twitter)

---

## 4. Please share the link to your public video post

**Answer (you'll fill this after posting):**

```
https://twitter.com/YOUR_USERNAME/status/TWEET_ID
```

**How to get this:**
1. Upload video to X (Twitter)
2. After posting, click on your tweet
3. Copy the URL from your browser address bar

---

## 5. Please provide a step-by-step guide on how other users can replicate your agent

**Answer (copy-paste this):**

```markdown
# TradeGuard Replication Guide

## Prerequisites
- Node.js 22+ installed
- Binance account with Agentic sub-account
- Claude Code CLI OR any MCP-compatible agent (OpenClaw, custom agents)

---

## Installation

### Step 1: Clone and build TradeGuard

```bash
git clone https://github.com/devIykee/tradeguard.git
cd tradeguard
npm install
npm run build
```

Build output goes to `dist/` directory. Verify success:
```bash
ls dist/
# Should show: binance/ config/ interfaces/ rules/ server/
```

---

## Deployment Mode 1: Claude Code Hook (Simplest)

### Step 1: Connect Binance MCP server

```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
```

A browser window opens. Complete OAuth flow:
- Sign in to Binance
- Grant scopes: Market data + Account + Trade
- Close browser when done

### Step 2: Install TradeGuard hook

```bash
# In your Claude Code project directory (e.g., /home/yourname):
cd /home/yourname
mkdir -p .claude/hooks
cp /path/to/tradeguard/.claude/hooks/tradeguard.json .claude/hooks/
```

Edit `.claude/hooks/tradeguard.json` — update the `command` path to point to your tradeguard installation:

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

Example: `/home/yourname/tradeguard/bin/validate-trade.js`

### Step 3: Start Claude Code

```bash
cd /home/yourname
claude
```

TradeGuard is now active. Any Binance trade will be validated before execution.

---

## Deployment Mode 2: MCP Proxy Server (Works with any agent)

### Step 1: Get Binance OAuth token

Visit https://agent.binance.com/mcp/agentic in any browser. Complete OAuth flow.

Open browser dev tools → Network tab → find any request to `agent.binance.com` → copy the `Authorization: Bearer <token>` header value.

### Step 2: Start TradeGuard as MCP server

```bash
cd tradeguard
BINANCE_TOKEN=your_bearer_token node bin/start-server.js
```

Leave this terminal open. You'll see:
```
TradeGuard MCP Server running on stdio
Loaded 4 rules from config/risk-rules.json
Ready to validate Binance trades
```

### Step 3: Configure your agent

**Claude Code:**
```bash
claude mcp add tradeguard stdio node /absolute/path/to/tradeguard/bin/start-server.js
```

Set environment variable before starting:
```bash
export BINANCE_TOKEN=your_bearer_token
claude
```

**OpenClaw or other MCP agents:**
Add to your agent's MCP configuration:
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

---

## Testing TradeGuard

### Test 1: Excessive leverage (should block)

In your agent:
```
Open a 10x leveraged long position on BTCUSDT, 0.01 BTC
```

Expected result:
```
❌ Permission denied: Leverage 10x exceeds max allowed 5x
```

### Test 2: Symbol not whitelisted (should block)

```
Buy 100 DOGE at market on Binance spot
```

Expected result:
```
❌ Permission denied: Symbol "DOGEUSDT" not in whitelist. Allowed: btcusdt, ethusdt, bnbusdt
```

### Test 3: Price deviation (should block)

```
What's the current BTCUSDT price?
```

Agent returns current price (e.g., $65,000). Then:

```
Place a limit buy for 0.01 BTC at $72,000
```

Expected result:
```
❌ Permission denied: Proposed price $72,000 deviates 10.0% from live market $65,000 (max allowed 2.0%)
```

### Test 4: Valid trade (should pass)

```
Buy 0.0001 BTC at market price on Binance spot
```

Expected result:
```
✅ TradeGuard validation passed
✅ Binance confirmation prompt appears: "Confirm trade?"
```

---

## Customize Risk Rules

Edit `config/risk-rules.json`:

```json
{
  "maxLeverage": 5,
  "maxOrderSizeUSDT": 1000,
  "maxPriceDeviationPct": 2.0,
  "allowedSymbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"]
}
```

Rebuild after changes:
```bash
npm run build
```

Restart TradeGuard (if running as MCP server) or restart Claude Code (if using hook mode).

---

## Verification

### Verify hook is registered (Mode 1 only):

```bash
cat /home/yourname/.claude/hooks/tradeguard.json
```

Should show the PreToolUse hook config.

### Verify hook script executes manually:

```bash
echo '{"tool_name":"mcp__binance-mcp-server__place_order","tool_input":{"symbol":"BTCUSDT","leverage":10},"session_id":"test","tool_use_id":"test","hook_event_name":"PreToolUse"}' | node /path/to/tradeguard/bin/validate-trade.js
```

Expected output:
```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "Leverage 10x exceeds max allowed 5x"
  }
}
```

### Run unit tests:

```bash
cd tradeguard
npm test
```

Expected: 61 tests passing in ~1 second.

---

## Funding (Optional)

TradeGuard validates trades but doesn't require funding for blocked scenarios (which never execute). Only needed if you want to test one passing trade end-to-end.

Transfer funds to Agentic sub-account manually via Binance web UI:
```
https://www.binance.com/en/my/sub-account/asset-management/transfer?asset=BTC
```

Recommend: $5-10 USDT for demo purposes only.

---

## Troubleshooting

**"I don't have access to Binance MCP":**
```bash
claude mcp list
# Should show: binance-mcp-server
```

If not listed, re-run:
```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
```

**TradeGuard doesn't block trades:**

Check hook is registered:
```bash
cat ~/.claude/hooks/tradeguard.json
# OR
cat /your/project/.claude/hooks/tradeguard.json
```

If file doesn't exist, repeat Step 2 of Mode 1 setup.

**Bearer token expired (Mode 2):**

OAuth tokens expire after ~24 hours. Re-authenticate at https://agent.binance.com/mcp/agentic and extract a fresh token.

---

## Documentation

Full docs at: https://github.com/devIykee/tradeguard

- README.md — Installation, demo scenarios
- ARCHITECTURE.md — SOLID principles, data flow
- DEVELOPMENT.md — Dev guide, troubleshooting
- API.md — Complete API reference
- DEMO_VIDEO_GUIDE.md — Video recording instructions

---

## Support

Issues/questions: https://github.com/devIykee/tradeguard/issues
```

---

## Summary — Copy These 5 Answers Into The Form

1. **Theme:** Trading Workflows
2. **Description:** [Copy from section 2 above]
3. **Platform:** X
4. **Video link:** https://twitter.com/YOUR_USERNAME/status/TWEET_ID
5. **Replication guide:** [Copy from section 5 above]

Save this file for reference when filling the form! 📋
