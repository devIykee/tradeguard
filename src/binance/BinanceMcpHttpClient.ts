import type { MarketDataSource } from '../interfaces/MarketDataSource.js';
import type { AccountReader, Balance } from '../interfaces/AccountReader.js';
import type { TradeExecutor, TradeResult } from '../interfaces/TradeExecutor.js';
import type { ProposedTrade } from '../interfaces/TradeRule.js';

/**
 * BinanceMcpHttpClient: connects to the real Binance MCP endpoint.
 *
 * Unlike the placeholder BinanceMcpClient, this implementation uses
 * OAuth bearer-token pass-through — the user authenticates with Binance
 * directly and passes the token here. TradeGuard never stores credentials.
 *
 * Used by TradeGuardServer (MCP proxy mode) to forward validated calls
 * to Binance, and to fetch live market data for PriceDeviationRule/MaxOrderSizeRule.
 *
 * ## Tool names
 * Actual tool names are resolved at runtime via tools/list. If names change,
 * this client adapts automatically — nothing is hardcoded.
 */
export class BinanceMcpHttpClient implements MarketDataSource, AccountReader, TradeExecutor {
  private readonly endpoint = 'https://agent.binance.com/mcp/agentic';

  constructor(private readonly bearerToken: string) {
    if (!bearerToken) {
      throw new Error('BinanceMcpHttpClient requires a bearer token. Authenticate with Binance first.');
    }
  }

  /**
   * Send a raw JSON-RPC 2.0 request to the Binance MCP endpoint.
   */
  private async rpc(method: string, params: unknown): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    });

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${this.bearerToken}`,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Binance MCP HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';

    // Handle SSE (Server-Sent Events) response
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      // Parse last data: line from SSE stream
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data && data !== '[DONE]') {
            return JSON.parse(data);
          }
        }
      }
      throw new Error('Empty SSE response from Binance MCP');
    }

    const json = await response.json() as { result?: unknown; error?: { message: string } };
    if (json.error) {
      throw new Error(`Binance MCP error: ${json.error.message}`);
    }
    return json.result;
  }

  /**
   * Call a specific MCP tool by name with the given arguments.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.rpc('tools/call', { name: toolName, arguments: args });
  }

  /**
   * List all available tools from Binance MCP (cached after first call).
   */
  async listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }> {
    const result = await this.rpc('tools/list', {});
    return result as { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> };
  }

  /**
   * Find tool whose name contains a keyword (case-insensitive).
   * Used to resolve tool names at runtime rather than hardcoding them.
   */
  async findTool(keyword: string): Promise<string | undefined> {
    const { tools } = await this.listTools();
    const match = tools.find(t => t.name.toLowerCase().includes(keyword.toLowerCase()));
    return match?.name;
  }

  // ── MarketDataSource ──────────────────────────────────────────────────────

  async getLivePrice(symbol: string): Promise<number> {
    // First try Binance public REST API (no auth required, fastest)
    try {
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { price: string };
        return parseFloat(data.price);
      }
    } catch {
      // Fall through to MCP tool
    }

    // Fallback: use MCP market data tool
    const toolName = await this.findTool('ticker') ?? await this.findTool('price');
    if (!toolName) {
      throw new Error(`No ticker/price tool found in Binance MCP for ${symbol}`);
    }

    const result = await this.callTool(toolName, { symbol }) as { price?: string; lastPrice?: string };
    const price = result?.price ?? result?.lastPrice;
    if (!price) {
      throw new Error(`No price in response from ${toolName} for ${symbol}`);
    }
    return parseFloat(price);
  }

  async get24hChange(symbol: string): Promise<number> {
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json() as { priceChangePercent: string };
      return parseFloat(data.priceChangePercent);
    }
    throw new Error(`Could not fetch 24h change for ${symbol}`);
  }

  // ── AccountReader ────────────────────────────────────────────────────────

  async getBalance(): Promise<Balance> {
    const toolName = await this.findTool('balance') ?? await this.findTool('account');
    if (!toolName) {
      throw new Error('No balance/account tool found in Binance MCP');
    }

    const result = await this.callTool(toolName, {}) as {
      totalEquityUSDT?: number;
      balances?: Array<{ asset: string; free: string; locked: string }>;
    };

    const assets: Record<string, { free: number; locked: number }> = {};
    for (const b of (result.balances ?? [])) {
      assets[b.asset] = { free: parseFloat(b.free), locked: parseFloat(b.locked) };
    }

    return {
      totalEquityUSDT: result.totalEquityUSDT ?? 0,
      assets,
    };
  }

  // ── TradeExecutor ────────────────────────────────────────────────────────

  async submitTrade(trade: ProposedTrade): Promise<TradeResult> {
    const toolName = await this.findTool('order') ?? await this.findTool('trade');
    if (!toolName) {
      throw new Error('No order/trade tool found in Binance MCP');
    }

    const args: Record<string, unknown> = {
      symbol: trade.symbol,
      side: trade.side,
      type: trade.type,
      quantity: trade.quantity,
    };
    if (trade.price !== undefined) args['price'] = trade.price;
    if (trade.stopPrice !== undefined) args['stopPrice'] = trade.stopPrice;
    if (trade.leverage !== undefined) args['leverage'] = trade.leverage;

    const result = await this.callTool(toolName, args) as {
      orderId?: string;
      executedQty?: string;
      price?: string;
      status?: string;
    };

    return {
      success: result.status !== 'REJECTED',
      orderId: result.orderId?.toString(),
      executedQty: result.executedQty ? parseFloat(result.executedQty) : undefined,
      executedPrice: result.price ? parseFloat(result.price) : undefined,
    };
  }
}
