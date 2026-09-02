/**
 * Provides read-only access to account data for validation rules.
 *
 * ## Interface Segregation
 *
 * This interface exposes ONLY account reads. Rules that need balance/equity
 * data (future enhancement: MaxOrderSizeRule checking % of equity) depend on
 * this interface, not on a broader interface that also includes trade execution.
 *
 * ## Implementations
 *
 * - BinanceMcpClient: pulls balance via Binance MCP Account scope
 * - MockAccountReader (tests): returns hardcoded balances
 */
export interface Balance {
  /** Total account equity in USDT (or configured base currency) */
  totalEquityUSDT: number;

  /** Available balance per asset */
  assets: Record<string, { free: number; locked: number }>;
}

export interface AccountReader {
  /**
   * Get current account balance and equity.
   *
   * @returns Balance object with total equity and per-asset breakdown
   * @throws If account data is unavailable or auth fails
   */
  getBalance(): Promise<Balance>;
}
