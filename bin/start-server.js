#!/usr/bin/env node

/**
 * TradeGuard MCP Server Entry Point
 *
 * Starts TradeGuard as a standalone MCP server that proxies Binance MCP.
 * Works with any MCP-compatible agent (Claude Code, OpenClaw, custom agents).
 *
 * Usage:
 *   BINANCE_TOKEN=your_oauth_token node bin/start-server.js
 *
 * Agent setup:
 *   claude mcp add tradeguard sse node /absolute/path/to/bin/start-server.js
 *
 * The BINANCE_TOKEN is obtained by authenticating with Binance directly:
 *   1. Visit https://agent.binance.com/mcp/agentic in browser
 *   2. Complete OAuth flow
 *   3. Extract bearer token from browser's dev tools (Network tab)
 *   4. Set as environment variable
 *
 * TradeGuard never stores the token — it's passed at runtime.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Check for required environment variable
const binanceToken = process.env.BINANCE_TOKEN;
if (!binanceToken) {
  console.error('ERROR: BINANCE_TOKEN environment variable not set');
  console.error('');
  console.error('Usage:');
  console.error('  BINANCE_TOKEN=your_token node bin/start-server.js');
  console.error('');
  console.error('How to get token:');
  console.error('  1. Authenticate with Binance Agent OS in browser');
  console.error('  2. Open browser dev tools → Network tab');
  console.error('  3. Find request to agent.binance.com/mcp/agentic');
  console.error('  4. Copy Authorization header value (starts with "Bearer ")');
  console.error('  5. Set BINANCE_TOKEN=that_value');
  process.exit(1);
}

const configPath = process.env.CONFIG_PATH ?? resolve(PROJECT_ROOT, 'config/risk-rules.json');

// Dynamic import to allow ESM
const { TradeGuardServer } = await import(`${PROJECT_ROOT}/dist/server/TradeGuardServer.js`);

const server = new TradeGuardServer(binanceToken, configPath);

try {
  await server.start(configPath);
} catch (error) {
  console.error('Failed to start TradeGuard server:', error);
  process.exit(1);
}
