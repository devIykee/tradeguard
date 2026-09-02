# TradeGuard API Reference

**Complete API documentation for all public interfaces and classes**

---

## Table of Contents

1. [Core Interfaces](#core-interfaces)
2. [Rule Engine](#rule-engine)
3. [Built-in Rules](#built-in-rules)
4. [Configuration](#configuration)
5. [Hook Contract](#hook-contract)
6. [Type Definitions](#type-definitions)

---

## Core Interfaces

### `TradeRule`

Base interface for all validation rules. Every rule must implement this contract.

```typescript
interface TradeRule {
  readonly name: string;
  evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult>;
}
```

**Properties:**
- `name` — Stable identifier for this rule (kebab-case, used in logs and error messages)

**Methods:**

#### `evaluate(trade, context)`

Evaluate a proposed trade against this rule.

**Parameters:**
- `trade: ProposedTrade` — The trade to validate
- `context: RuleContext` — Validation context (timestamp, session info)

**Returns:** `Promise<ValidationResult>`

**Contract guarantees:**
- Never throws (malformed input returns failed result with reason)
- Deterministic (same input → same output, always)
- Stateless (except VelocityLimitRule which reads injected state)

**Example:**
```typescript
const result = await rule.evaluate(
  { symbol: 'BTCUSDT', side: 'BUY', quantity: 0.01, leverage: 10, market: 'FUTURES' },
  { validationTimestamp: '2026-09-02T15:00:00Z' }
);

if (!result.passed) {
  console.log(result.reason); // "Leverage 10x exceeds max allowed 5x"
}
```

---

### `MarketDataSource`

Provides live market data for validation rules.

```typescript
interface MarketDataSource {
  getLivePrice(symbol: string): Promise<number>;
  get24hChange?(symbol: string): Promise<number>;
}
```

**Methods:**

#### `getLivePrice(symbol)`

Get the current live price for a trading pair.

**Parameters:**
- `symbol: string` — Trading pair (e.g., "BTCUSDT")

**Returns:** `Promise<number>` — Last trade price from exchange

**Throws:** If symbol is invalid or market data unavailable

**Example:**
```typescript
const price = await marketData.getLivePrice('BTCUSDT');
// Returns: 65432.50
```

#### `get24hChange(symbol)` (optional)

Get 24-hour price change percentage.

**Parameters:**
- `symbol: string` — Trading pair

**Returns:** `Promise<number>` — Percentage change (e.g., 3.45 for +3.45%)

---

### `AccountReader`

Provides read-only access to account data.

```typescript
interface AccountReader {
  getBalance(): Promise<Balance>;
}
```

**Methods:**

#### `getBalance()`

Get current account balance and equity.

**Returns:** `Promise<Balance>`

```typescript
interface Balance {
  totalEquityUSDT: number;
  assets: Record<string, { free: number; locked: number }>;
}
```

**Example:**
```typescript
const balance = await accountReader.getBalance();
console.log(balance.totalEquityUSDT); // 5000.00
console.log(balance.assets.BTC); // { free: 0.05, locked: 0.01 }
```

---

### `TradeExecutor`

Executes trades (not used in hook path, present for Open/Closed principle).

```typescript
interface TradeExecutor {
  submitTrade(trade: ProposedTrade): Promise<TradeResult>;
}
```

**Methods:**

#### `submitTrade(trade)`

Submit a trade to the exchange.

**Parameters:**
- `trade: ProposedTrade` — Trade to execute

**Returns:** `Promise<TradeResult>`

```typescript
interface TradeResult {
  success: boolean;
  orderId?: string;
  executedQty?: number;
  executedPrice?: number;
  error?: string;
}
```

---

## Rule Engine

### `RuleEngine`

Orchestrates validation of a proposed trade against multiple rules.

```typescript
class RuleEngine {
  constructor(rules: TradeRule[]);
  evaluate(trade: ProposedTrade, context: RuleContext): Promise<ValidationResult>;
  getRules(): readonly TradeRule[];
}
```

**Constructor:**

```typescript
const engine = new RuleEngine([
  new MaxLeverageRule(5),
  new SymbolWhitelistRule(['BTCUSDT', 'ETHUSDT']),
  new MaxOrderSizeRule(1000, marketDataSource),
]);
```

**Methods:**

#### `evaluate(trade, context)`

Evaluate trade against all registered rules. Short-circuits on first failure.

**Parameters:**
- `trade: ProposedTrade` — Trade to validate
- `context: RuleContext` — Validation context

**Returns:** `Promise<ValidationResult>`
- If any rule fails: returns that rule's result
- If all pass: returns `{ passed: true, ruleName: 'all-rules' }`

**Example:**
```typescript
const result = await engine.evaluate(trade, context);

if (!result.passed) {
  console.log(`Blocked by ${result.ruleName}: ${result.reason}`);
  // "Blocked by max-leverage: Leverage 10x exceeds max allowed 5x"
}
```

#### `getRules()`

Get list of registered rules (for debugging/logging).

**Returns:** `readonly TradeRule[]`

---

## Built-in Rules

### `MaxLeverageRule`

Blocks futures trades exceeding configured leverage.

```typescript
class MaxLeverageRule implements TradeRule {
  constructor(maxLeverage: number);
  readonly name = 'max-leverage';
}
```

**Constructor:**
- `maxLeverage: number` — Maximum leverage multiplier (1-125)
- Throws if `maxLeverage <= 0` or not finite

**Validation logic:**
- SPOT trades: always pass (no leverage)
- FUTURES trades: `trade.leverage > maxLeverage` → fail

**Example:**
```typescript
const rule = new MaxLeverageRule(5);

// PASS: 3x leverage
await rule.evaluate({ leverage: 3, market: 'FUTURES', ... });

// FAIL: 10x leverage
await rule.evaluate({ leverage: 10, market: 'FUTURES', ... });
// Returns: { passed: false, reason: "Leverage 10x exceeds max allowed 5x" }
```

---

### `SymbolWhitelistRule`

Blocks trades on symbols outside the allowed list.

```typescript
class SymbolWhitelistRule implements TradeRule {
  constructor(allowedSymbols: string[]);
  readonly name = 'symbol-whitelist';
  getAllowedSymbols(): readonly string[];
}
```

**Constructor:**
- `allowedSymbols: string[]` — Allowed trading pairs (case-insensitive)
- Throws if array is empty

**Validation logic:**
- Symbol in whitelist (case-insensitive) → pass
- Symbol not in whitelist → fail

**Example:**
```typescript
const rule = new SymbolWhitelistRule(['BTCUSDT', 'ETHUSDT']);

// PASS: in whitelist (case-insensitive)
await rule.evaluate({ symbol: 'btcusdt', ... });

// FAIL: not in whitelist
await rule.evaluate({ symbol: 'DOGEUSDT', ... });
// Returns: { passed: false, reason: "Symbol 'DOGEUSDT' not in whitelist. Allowed: btcusdt, ethusdt" }
```

**Methods:**

#### `getAllowedSymbols()`

Get allowed symbols (for debugging).

**Returns:** `readonly string[]` — Lowercase normalized symbols

---

### `MaxOrderSizeRule`

Blocks trades exceeding configured notional size in USDT.

```typescript
class MaxOrderSizeRule implements TradeRule {
  constructor(maxOrderSizeUSDT: number, marketData: MarketDataSource);
  readonly name = 'max-order-size';
}
```

**Constructor:**
- `maxOrderSizeUSDT: number` — Maximum notional size in USDT (must be positive)
- `marketData: MarketDataSource` — Source for live prices
- Throws if `maxOrderSizeUSDT <= 0` or not finite

**Validation logic:**
1. Fetch live price: `livePrice = await marketData.getLivePrice(symbol)`
2. Calculate notional: `notional = quantity * livePrice`
3. Compare: `notional > maxOrderSizeUSDT` → fail

**Fail-safe:** If market data unavailable → deny with error message

**Example:**
```typescript
const rule = new MaxOrderSizeRule(1000, marketDataSource);

// PASS: 0.01 BTC * $50,000 = $500 (under $1000 max)
await rule.evaluate({ symbol: 'BTCUSDT', quantity: 0.01, ... });

// FAIL: 0.05 BTC * $50,000 = $2,500 (over $1000 max)
await rule.evaluate({ symbol: 'BTCUSDT', quantity: 0.05, ... });
// Returns: { passed: false, reason: "Order size 2500.00 USDT exceeds max allowed 1000.00 USDT..." }
```

---

### `PriceDeviationRule`

Blocks trades with prices deviating significantly from live market. **THE DIFFERENTIATOR.**

```typescript
class PriceDeviationRule implements TradeRule {
  constructor(maxDeviationPct: number, marketData: MarketDataSource);
  readonly name = 'price-deviation';
}
```

**Constructor:**
- `maxDeviationPct: number` — Maximum allowed deviation percentage (0.1-50)
- `marketData: MarketDataSource` — Source for live prices
- Throws if `maxDeviationPct <= 0` or not finite

**Validation logic:**
1. Extract proposed price(s) from trade:
   - LIMIT orders: `trade.price`
   - STOP orders: `trade.stopPrice`
   - STOP_LIMIT orders: both `trade.price` and `trade.stopPrice`
   - MARKET orders: no price → always pass
2. Fetch live price: `livePrice = await marketData.getLivePrice(symbol)`
3. Calculate deviation: `deviation = abs((proposedPrice - livePrice) / livePrice) * 100`
4. Compare: `deviation > maxDeviationPct` → fail

**Fail-safe:** If market data unavailable → deny with error message

**Example:**
```typescript
const rule = new PriceDeviationRule(2.0, marketDataSource);

// PASS: $50,500 proposed, $50,000 live = 1% deviation (under 2%)
await rule.evaluate({ 
  symbol: 'BTCUSDT', 
  type: 'LIMIT', 
  price: 50500, 
  ... 
});

// FAIL: $52,500 proposed, $50,000 live = 5% deviation (over 2%)
await rule.evaluate({ 
  symbol: 'BTCUSDT', 
  type: 'LIMIT', 
  price: 52500, 
  ... 
});
// Returns: { 
//   passed: false, 
//   reason: "Proposed price $52500.00 deviates 5.00% from live market $50000.00 (max allowed 2.0%). Live price fetched at 2026-09-02T15:00:00Z. If market moved, retry with current price."
// }
```

**What this defends against:**
- Stale prices from cached context (agent's last data is 20 minutes old)
- Hallucinated prices (agent invents $95,000 when real is $68,000)
- Unit confusion (agent quotes satoshis as BTC)
- Typos in reasoning (reads $68,234 as $86,234)

---

## Configuration

### `loadRiskRulesConfig(configPath)`

Load and validate risk rules configuration from JSON file.

```typescript
function loadRiskRulesConfig(configPath: string): Promise<RiskRulesConfig>;
```

**Parameters:**
- `configPath: string` — Absolute or relative path to risk-rules.json

**Returns:** `Promise<RiskRulesConfig>` — Validated configuration object

**Throws:** 
- If file cannot be read
- If JSON is malformed
- If validation fails (Zod schema)

**Example:**
```typescript
import { loadRiskRulesConfig } from './config/risk-rules-loader.js';

const config = await loadRiskRulesConfig('./config/risk-rules.json');
console.log(config.maxLeverage); // 5
```

---

### `RiskRulesConfig`

Configuration object (TypeScript type, inferred from Zod schema).

```typescript
interface RiskRulesConfig {
  maxLeverage: number;              // 1-125
  maxOrderSizeUSDT: number;         // >0
  maxPriceDeviationPct: number;     // 0.1-50
  allowedSymbols: string[];         // Must end in USDT, at least one
  symbolSpecificDeviations?: Record<string, number>; // Optional overrides
}
```

**Example:**
```json
{
  "maxLeverage": 5,
  "maxOrderSizeUSDT": 1000,
  "maxPriceDeviationPct": 2.0,
  "allowedSymbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
  "symbolSpecificDeviations": {
    "SOLUSDT": 3.5
  }
}
```

---

## Hook Contract

### Input (stdin)

JSON object received by `bin/validate-trade.js` from PreToolUse hook:

```typescript
interface HookInput {
  tool_name: string;              // "mcp__binance-mcp-server__place_order"
  tool_input: Record<string, any>; // Raw MCP tool parameters
  tool_use_id: string;            // "toolu_01ABC123..."
  session_id: string;             // Session identifier
  hook_event_name: 'PreToolUse';
  cwd: string;                    // Current working directory
  permission_mode: string;        // "default" | "auto" | etc.
}
```

**Example:**
```json
{
  "tool_name": "mcp__binance-mcp-server__place_order",
  "tool_input": {
    "symbol": "BTCUSDT",
    "side": "BUY",
    "type": "MARKET",
    "quantity": 0.01,
    "leverage": 10,
    "market": "FUTURES"
  },
  "tool_use_id": "toolu_01XYZ",
  "session_id": "abc123",
  "hook_event_name": "PreToolUse",
  "cwd": "/home/user/project",
  "permission_mode": "default"
}
```

---

### Output (stdout)

JSON object written by hook script:

```typescript
interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
}
```

**Example (deny):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Leverage 10x exceeds max allowed 5x"
  }
}
```

**Example (allow):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow"
  }
}
```

---

### Exit Codes

- `0` — Validation completed (check JSON for allow/deny)
- `2` — Hard block (overrides any JSON "allow")
- `1` — Script error (treated as non-blocking by Claude Code)

---

## Type Definitions

### `ProposedTrade`

Represents a trade proposal from the agent.

```typescript
interface ProposedTrade {
  symbol: string;               // Trading pair, e.g., "BTCUSDT"
  side: 'BUY' | 'SELL';        // Order side
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT'; // Order type
  quantity: number;             // Quantity in base asset (e.g., 0.01 BTC)
  price?: number;               // Limit price (required for LIMIT/STOP_LIMIT)
  stopPrice?: number;           // Stop price (required for STOP/STOP_LIMIT)
  leverage?: number;            // Leverage multiplier (futures only)
  market: 'SPOT' | 'FUTURES';  // Market type
  rawToolInput?: Record<string, unknown>; // Original tool input
}
```

---

### `RuleContext`

Validation context passed to rules.

```typescript
interface RuleContext {
  validationTimestamp: string;  // ISO 8601 timestamp
  sessionId?: string;           // Session identifier
  toolUseId?: string;           // Tool use identifier
}
```

---

### `ValidationResult`

Result of rule evaluation.

```typescript
interface ValidationResult {
  passed: boolean;              // True if rule passed
  ruleName: string;             // Name of rule that produced this result
  reason?: string;              // Denial reason (omit if passed)
  additionalContext?: string;   // Optional context for agent
}
```

**Examples:**

```typescript
// Pass
{ passed: true, ruleName: 'max-leverage' }

// Fail
{
  passed: false,
  ruleName: 'max-leverage',
  reason: 'Leverage 10x exceeds max allowed 5x'
}
```

---

## Usage Examples

### Basic Validation

```typescript
import { RuleEngine } from './rules/RuleEngine.js';
import { MaxLeverageRule } from './rules/MaxLeverageRule.js';
import { SymbolWhitelistRule } from './rules/SymbolWhitelistRule.js';

const engine = new RuleEngine([
  new MaxLeverageRule(5),
  new SymbolWhitelistRule(['BTCUSDT', 'ETHUSDT']),
]);

const trade = {
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 0.01,
  leverage: 3,
  market: 'FUTURES',
};

const context = {
  validationTimestamp: new Date().toISOString(),
};

const result = await engine.evaluate(trade, context);

if (result.passed) {
  console.log('Trade approved');
} else {
  console.log(`Trade blocked: ${result.reason}`);
}
```

---

### Custom MarketDataSource

```typescript
class CustomMarketData implements MarketDataSource {
  async getLivePrice(symbol: string): Promise<number> {
    // Your implementation (e.g., fetch from custom API)
    const response = await fetch(`https://your-api.com/price/${symbol}`);
    const data = await response.json();
    return data.price;
  }
}

const marketData = new CustomMarketData();
const rule = new PriceDeviationRule(2.0, marketData);
```

---

### Hook Script Integration

```javascript
// bin/validate-trade.js
import { RuleEngine } from './dist/rules/RuleEngine.js';
import { loadRiskRulesConfig } from './dist/config/risk-rules-loader.js';

const config = await loadRiskRulesConfig('./config/risk-rules.json');

const rules = [
  new MaxLeverageRule(config.maxLeverage),
  new SymbolWhitelistRule(config.allowedSymbols),
  // ... other rules
];

const engine = new RuleEngine(rules);
const result = await engine.evaluate(trade, context);

const output = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: result.passed ? 'allow' : 'deny',
    permissionDecisionReason: result.reason,
  }
};

process.stdout.write(JSON.stringify(output));
```

---

## Error Handling

### Rule Contract: Never Throw

All rules must handle errors gracefully and return a failed `ValidationResult` instead of throwing.

**Example:**
```typescript
async evaluate(trade: ProposedTrade): Promise<ValidationResult> {
  try {
    const price = await this.marketData.getLivePrice(trade.symbol);
    // ... validation logic
  } catch (error) {
    // Don't throw — return failed result instead
    return {
      passed: false,
      ruleName: this.name,
      reason: `Market data unavailable: ${error.message}`,
    };
  }
}
```

### Hook Script: Fail-Safe Deny

Hook script wraps entire execution in try-catch. Any uncaught error → exit 2 (hard block).

```javascript
try {
  // ... validation logic
} catch (error) {
  stderr.write(`TradeGuard error: ${error.message}\n`);
  stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Validation failed: ${error.message}`,
    }
  }));
  process.exit(2); // Hard block
}
```

---

## Versioning

TradeGuard follows semantic versioning:

- **Major (1.x.x)**: Breaking API changes (e.g., rule interface changes)
- **Minor (x.1.x)**: New features (e.g., new rules added)
- **Patch (x.x.1)**: Bug fixes, config tweaks

Current version: **1.0.0**

---

## Support

For questions or issues:
- GitHub Issues: [https://github.com/YOUR_USERNAME/tradeguard/issues](https://github.com/YOUR_USERNAME/tradeguard/issues)
- Documentation: See README.md, ARCHITECTURE.md, DEVELOPMENT.md

---

Generated for TradeGuard v1.0.0
