/**
 * Provides live market data for validation rules.
 *
 * ## Interface Segregation
 *
 * This interface exposes ONLY market data reads. Rules that need price data
 * (PriceDeviationRule) depend on this interface, not on a broader interface
 * that also includes account reads or trade execution.
 *
 * ## Implementations
 *
 * - BinanceMcpClient: pulls live ticker via Binance MCP Market Data scope
 * - MockMarketDataSource (tests): returns hardcoded prices
 */
export interface MarketDataSource {
  /**
   * Get the current live price for a symbol.
   *
   * @param symbol Trading pair, e.g. "BTCUSDT"
   * @returns Last trade price from the exchange (most recent ticker.lastPrice)
   * @throws If symbol is invalid or market data is unavailable
   */
  getLivePrice(symbol: string): Promise<number>;

  /**
   * Get the 24-hour price change percentage for a symbol (optional).
   *
   * Used by rules that check momentum or volatility (e.g., VelocityLimitRule
   * in nice-to-have tier). Not required for core tier rules.
   *
   * @param symbol Trading pair
   * @returns 24h price change as percentage (e.g., 3.45 for +3.45%)
   */
  get24hChange?(symbol: string): Promise<number>;
}
