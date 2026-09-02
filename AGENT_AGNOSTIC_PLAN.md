# Making TradeGuard Agent-Agnostic

## Current State
- TradeGuard works as a Claude Code PreToolUse hook
- Hook fires when Claude Code calls Binance MCP tools
- Architecture is actually already agent-agnostic at the core (RuleEngine, all rules)
- Only the integration layer (bin/validate-trade.js) is Claude Code-specific

## Agent-Agnostic Strategy

### Option 1: MCP Proxy Server (RECOMMENDED)
Make TradeGuard a standalone MCP server that wraps Binance's MCP server.

**How it works:**
```
Agent (any) → TradeGuard MCP Server → Binance MCP Server
              (validates, then forwards)
```

**Advantages:**
- Works with ANY MCP-compatible agent (Claude Code, OpenClaw, custom agents)
- Standard MCP protocol (no hooks needed)
- Binance MCP server stays untouched
- Agent sees TradeGuard as a normal MCP server

**Architecture:**
```typescript
// TradeGuard MCP Server
class TradeGuardMcpServer {
  private binanceClient: BinanceClient;
  private ruleEngine: RuleEngine;
  
  async listTools() {
    // Expose same tools as Binance MCP server
    return this.binanceClient.listTools();
  }
  
  async callTool(name: string, args: any) {
    // 1. Validate with RuleEngine
    const result = await this.ruleEngine.evaluate(args);
    
    if (!result.passed) {
      // 2a. Blocked — return error
      return { error: result.reason };
    }
    
    // 2b. Passed — forward to Binance
    return await this.binanceClient.callTool(name, args);
  }
}
```

**Connection:**
```bash
# Instead of:
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic

# User adds:
claude mcp add tradeguard --transport http http://localhost:3000
# TradeGuard server internally connects to Binance
```

**Agent support:**
- ✅ Claude Code
- ✅ OpenClaw (Telegram)
- ✅ Any MCP-compatible agent
- ✅ Custom agents via @modelcontextprotocol/sdk

---

### Option 2: Middleware Library
Publish TradeGuard as an npm package that agent developers import.

**How it works:**
```typescript
import { TradeGuard } from '@tradeguard/validator';

const guard = new TradeGuard(config);

// Before calling Binance:
const result = await guard.validate(trade);
if (!result.passed) {
  throw new Error(result.reason);
}
```

**Advantages:**
- Lightest weight (no server needed)
- Agent developers have full control
- Easy to customize per agent

**Disadvantages:**
- Requires code changes in each agent
- Not plug-and-play for end users

---

### Option 3: Dual Mode (BEST FOR HACKATHON)
Ship both:
1. Claude Code hook (already done)
2. Standalone MCP proxy server (new)

Users pick based on their agent:
- Claude Code users → use hook (no server needed)
- OpenClaw/other agents → use MCP server

---

## Implementation: MCP Proxy Server

### New file structure:
```
tradeguard/
├── src/
│   ├── rules/           (unchanged)
│   ├── interfaces/      (unchanged)
│   ├── binance/         (unchanged)
│   ├── config/          (unchanged)
│   └── server/          (NEW)
│       ├── TradeGuardServer.ts
│       └── index.ts
├── bin/
│   ├── validate-trade.js  (Claude Code hook)
│   └── start-server.js    (NEW - MCP server)
```

### Core changes needed:

1. **TradeGuardServer.ts** - MCP server that wraps Binance
2. **start-server.js** - Entry point for standalone server
3. **BinanceMcpClient.ts** - Add MCP client implementation
4. **README.md** - Add server setup instructions

---

## Time Estimate
- MCP server implementation: 2-3 hours
- Testing with multiple agents: 1 hour
- Documentation updates: 30 min
- **Total: ~4 hours**

---

## Hackathon Impact
Adding MCP server mode makes TradeGuard:
- ✅ Compatible with ALL agents (bigger market)
- ✅ More impressive technically
- ✅ Stronger competitive position
- ✅ Production-ready for any MCP ecosystem

Worth doing if time allows before Sept 8 deadline.
