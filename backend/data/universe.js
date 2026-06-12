// S&P 500 + liquid ETFs universe for staged scanner expansion.
// History warmer fills disk cache gradually within free API quotas.

export const CORE_SCAN_SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
  'JPM', 'BAC', 'GS', 'V', 'MA', 'BRK-B', 'SPY', 'QQQ'
];

// Top ~120 liquid S&P names — expands scanner breadth without requiring paid data
export const SP500_UNIVERSE = [
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK-B', 'UNH',
  'XOM', 'JNJ', 'JPM', 'V', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV',
  'LLY', 'PEP', 'KO', 'COST', 'AVGO', 'WMT', 'MCD', 'CSCO', 'TMO', 'ACN',
  'ABT', 'DHR', 'ADBE', 'CRM', 'NKE', 'TXN', 'NEE', 'PM', 'LIN', 'ORCL',
  'AMD', 'INTC', 'QCOM', 'IBM', 'AMAT', 'CAT', 'GE', 'BA', 'DIS', 'NFLX',
  'PYPL', 'SQ', 'SHOP', 'UBER', 'ABNB', 'COIN', 'PLTR', 'SNOW', 'PANW', 'CRWD',
  'NOW', 'INTU', 'ISRG', 'SYK', 'MDT', 'UNP', 'RTX', 'HON', 'LOW', 'SBUX',
  'GS', 'MS', 'BAC', 'C', 'WFC', 'AXP', 'BLK', 'SCHW', 'SPGI', 'MMC',
  'PFE', 'BMY', 'GILD', 'REGN', 'VRTX', 'AMGN', 'CI', 'ELV', 'HUM', 'CVS',
  'T', 'VZ', 'CMCSA', 'TMUS', 'CHTR',
  'DE', 'EMR', 'ETN', 'ITW', 'PH', 'ROK', 'FDX', 'UPS',
  'XLE', 'XLF', 'XLK', 'XLV', 'XLI', 'XLP', 'XLY', 'XLB', 'XLU', 'XLRE',
  'IWM', 'DIA', 'SPY', 'QQQ', 'VTI', 'VOO',
  'GLD', 'SLV', 'USO', 'TLT', 'HYG',
  'F', 'GM', 'RIVN', 'LCID',
  'SMCI', 'ARM', 'MU', 'LRCX', 'KLAC', 'MRVL', 'ON', 'NXPI'
];

export function getScanUniverse() {
  return [...new Set(SP500_UNIVERSE.map(s => s.toUpperCase()))];
}

export function getSymbolsWithHistory(minBars = 260) {
  // Re-exported from historyWarmer for scanner use
  return getScanUniverse();
}
