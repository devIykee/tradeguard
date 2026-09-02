# Phase 0 — Documentation Verification (Complete)

## Network Constraint

Binance domains (`developers.binance.com`, `agent.binance.com`, `api.binance.com`) failed DNS resolution on the WSL2 resolver (10.255.255.254) with NXDOMAIN/REFUSED errors. VPN connection restored access. Direct curl with DNS-over-HTTPS (Cloudflare 1.1.1.1) confirmed the block was DNS-level, not IP-level.

## Documentation Retrieved

**Source:** `https://developers.binance.com/en/docs/llms-full.txt` (HTTP 200, 1.98 MB, uncompressed 8 MB)

Machine-readable doc dump containing verbatim Binance Agent Native documentation, synced 2026-08-17 from internal repo `be/agentic-tools@d3e0564`.

### Binance MCP Server — Key Facts (Quoted)

**Endpoint:**
```
https://agent.binance.com/mcp/agentic
```

**Connection command (Claude Code):**
```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
```

**Warning (exact quote from docs):**
> Never paste the MCP endpoint into an AI chat and ask it to install the server, and never open the endpoint directly in your browser. Follow the setup steps for your client in the tabs below instead.

**Scopes (exact quote):**
> When you connect, you choose which scopes to grant. Start with the least you need:
> - **Market data** (public, no auth) — tickers, order books, candles, funding
> - **Account** — Agentic sub-account balance, positions, bills; optional read-only view of your main account
> - **Trade** — spot, margin, convert, futures (only what you grant and your account is authorized for)
> - **Transfer** — move funds between wallets inside the same Agentic sub-account only
> 
> There is **no withdrawal scope**. Your agent can never move funds out of the sub-account to an external address.

**Confirm-before-execute flow (exact quote):**
> This confirm-before-execute pattern applies to every non-read action — orders, cancels, and transfers between your sub-account wallets.

Context from example scenario:
> Step 3: Place a trade (write — the agent confirms first)
> Quote: "Buy $100 of BNB at market on spot."
> Outcome: "The agent restates the order — symbol, side, type, amount — and waits for your yes before sending it. Always verify the details here; this is the step that spends real funds."

**Sub-account funding (exact quote):**
> The sub-account starts empty. Before your agent can trade, you must transfer funds into it yourself from the Binance web UI — this is a manual action; the agent cannot move funds from your main account into the sub-account. [...] Fund it via:
> 
> https://www.binance.com/en/my/sub-account/asset-management/transfer?asset=BTC

**OAuth model:**
- OAuth 2.1 Authorization Code + PKCE (S256)
- Token endpoint auth: `none` (public client)
- Authorization server: `https://agent.binance.com`
- Authorization endpoint: `https://accounts.binance.com/agentic-oauth/authorize`
- Token endpoint: `https://accounts.binance.com/oauth-agentic/token`
- `client_id_metadata_document_supported: true`
- **No `registration_endpoint`** — no RFC 7591 dynamic client registration

Per-client OAuth client IDs are pre-provisioned: `claude` for Claude Code, `codex` for Codex CLI, `grok` for Grok Bot, etc.

## What Could NOT Be Verified

**MCP tool names and input schemas:**
The docs do not list tool names. The MCP `tools/list` call against `https://agent.binance.com/mcp/agentic` returns **HTTP 401** without OAuth credentials. The user has not yet run `claude mcp add binance-mcp-server`, so no live connection exists to inspect tool schemas via `/mcp` menu.

**Assumed tool naming:** Based on MCP convention (`mcp__<server>__<tool>`), Binance tools likely follow `mcp__binance-mcp-server__*` pattern, but exact names like `place_order`, `get_ticker`, `get_account_balance`, etc. are unconfirmed until a connection is established.

**Confirm-before-execute enforcement layer:**
Docs state the pattern applies, but do not specify whether it's enforced client-side (Claude Code's MCP tool permission prompt) or server-side (Binance API requires two-step flow). From context, it appears to be client-side via Claude Code's standard tool approval flow.

## Binance Agent OS vs Binance Agentic Wallet

Two separate products found in docs:

1. **Binance Agent OS / MCP Server** (the target for TradeGuard):
   - CEX trading: spot, margin, convert, USDⓈ-M and COIN-M futures
   - Agentic sub-account (isolated from main account)
   - MCP endpoint: `https://agent.binance.com/mcp/agentic`

2. **Binance Agentic Wallet** (different product, NOT in scope):
   - On-chain / DeFi operations
   - MPC keyless wallet
   - Not part of this hackathon track

