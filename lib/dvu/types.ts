export type DVUDirection = 'LONG' | 'SHORT';

// TradingView webhook formats supported by DVU.
// Format 2: "DVU Full Signal" (comprehensive, single ticker)
export interface DVUFullSignalPayload {
  signal: {
    type: string;
    direction: DVUDirection;
    confluence_score: number;
    max_confluence: number;
    quality_stars: string;
    is_legendary: boolean;
    is_mega: boolean;
  };
  market: {
    ticker: string;
    symbol?: string;
    exchange?: string;
    type?: string;
    currency?: string;
    timestamp: number; // ms epoch
    timestamp_close?: number; // ms epoch
    timeframe: string; // e.g. "15"
    timeframe_minutes: number;
  };
  price: {
    entry: number;
    open: number;
    high: number;
    low: number;
    close: number;
    body_percent: number;
  };
  volume?: {
    z_score: number;
    vs_mean_percent: number;
    is_unusual: boolean;
  };
  structure?: {
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | string;
    trend_strength?: string;
  };
  vwap?: {
    value: number;
    position: 'ABOVE' | 'BELOW' | string;
    distance_pct: number;
    is_above?: boolean;
    is_below?: boolean;
  };
  macd?: {
    line: number;
    signal: number;
    histogram: number;
    direction: 'BULLISH' | 'BEARISH' | string;
    momentum?: string;
    has_momentum: boolean;
  };
  strat?: {
    patterns?: {
      detected_name?: string;
      is_rj?: boolean;
      is_nirvana?: boolean;
      is_2_2_reversal?: boolean;
      is_inside_breakout?: boolean;
      is_2_1_2?: boolean;
      is_ftfc?: boolean;
      is_50_pct?: boolean;
      is_holy_grail?: boolean;
      is_premium?: boolean;
    };
  };
  candle_patterns?: {
    any_bullish_pattern?: boolean;
    any_bearish_pattern?: boolean;
  };
  ict?: {
    amd_phase?: string;
    is_ny_session?: boolean;
    ny_hour?: number;
    ny_minute?: number;
  };
  levels?: {
    atr?: number;
    at_key_level?: boolean;
    near_atr_level?: boolean;
    near_fractal_support?: boolean;
    near_fractal_resistance?: boolean;
  };
  risk_management: {
    stop_loss: number;
    target_1: number;
    target_2: number;
    risk_amount: number;
    reward_amount: number;
    risk_reward_ratio: number;
    atr_value?: number;
    atr_multiplier?: number;
  };
  confluence: {
    total_score: number; // 0-8
  } & Record<string, boolean | number>;
}

// Format 1: "Scanner Signal" (lightweight, multiple tickers)
export interface DVUScannerSignalPayload {
  scanner: string;
  signal: {
    ticker: string;
    direction: DVUDirection;
    quality: 'LEGENDARY' | 'MEGA' | 'HIGH' | 'STANDARD' | string;
    trigger_tf: string; // minutes as string e.g. "5"
  };
  strat?: {
    tf1?: string;
    tf2?: string;
    tf3?: string;
  };
  conditions?: Record<string, boolean>;
  timestamp: number; // ms epoch
}

export type DVUWebhookPayload = DVUFullSignalPayload | DVUScannerSignalPayload;

export type NormalizedSignal = {
  source: 'scanner' | 'full';
  ticker: string;
  direction: DVUDirection;
  timestamp: number; // ms epoch
  timeframeMinutes: number;
  // Confluence is always normalized to a score + max.
  confluenceScore: number;
  maxConfluence: number;
  // Signal strength flags/labels (best effort for scanner format).
  qualityLabel?: string;
  isLegendary?: boolean;
  isMega?: boolean;
  // Optional risk plan; if absent the engine may derive it from ATR.
  entry?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  // Reference to original payload for debugging.
  raw: DVUWebhookPayload;
};

export type TradierQuote = {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  volume?: number;
};

export type TradierPosition = {
  symbol: string;
  quantity: number;
  costBasis?: number;
};

export type TradierBalances = {
  accountNumber?: string;
  equity?: number;
  buyingPower?: number;
  cash?: number;
};

export type TradierOption = {
  symbol: string;
  underlying?: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  greeks?: {
    delta: number;
    gamma?: number;
    theta: number;
    vega?: number;
    rho?: number;
    iv?: number;
    mid_iv?: number;
  };
};

export type OptionGreeks = NonNullable<TradierOption['greeks']>;

export type DVUOptionOrderSide =
  | 'buy_to_open'
  | 'sell_to_open'
  | 'buy_to_close'
  | 'sell_to_close';

export type DVUOptionLeg = {
  optionSymbol: string;
  side: DVUOptionOrderSide;
  quantity: number; // contracts
  expiration?: string;
  strike?: number;
  optionType?: 'call' | 'put';
  greeks?: TradierOption['greeks'];
  bid?: number;
  ask?: number;
  last?: number;
};

export type DVUOptionStructure =
  | 'SINGLE'
  | 'CALL_DEBIT_SPREAD'
  | 'PUT_DEBIT_SPREAD'
  | 'CALL_CREDIT_SPREAD'
  | 'PUT_CREDIT_SPREAD';

export type DVUOptionSpread = {
  structure: Exclude<DVUOptionStructure, 'SINGLE'>;
  expiration: string;
  width: number;
  // Best-effort pricing derived from chain quotes
  estimatedDebit?: number; // per spread, in option price units (not *100)
  estimatedCredit?: number; // per spread, in option price units (not *100)
  estimatedMaxLoss?: number; // dollars per spread (already *100)
  estimatedMaxProfit?: number; // dollars per spread (already *100)
  longLeg: DVUOptionLeg;
  shortLeg: DVUOptionLeg;
};

export type TwelveDataIndicators = {
  rsi?: number;
  atr?: number;
  adx?: number;
  stochK?: number;
  stochD?: number;
  bbUpper?: number;
  bbLower?: number;
  bbMiddle?: number;
};

export type AlpacaMarketStatus = {
  isOpen: boolean;
  timestamp?: string;
  nextOpen?: string;
  nextClose?: string;
};

export type AlpacaQuote = {
  symbol: string;
  last?: number;
  bid?: number;
  ask?: number;
  dailyVolume?: number;
};

export type DVUEnrichment = {
  tradierQuote?: TradierQuote;
  options?: TradierOption[];
  indicators?: TwelveDataIndicators;
  marketStatus?: AlpacaMarketStatus;
  alpacaQuote?: AlpacaQuote;
  tradierBalances?: TradierBalances;
  tradierPositions?: TradierPosition[];
  derived?: {
    spreadPct?: number;
    putCallRatio?: number;
    ivRank?: number; // estimated from chain (not true historical IV rank)
  };
};

export type DVUScores = {
  technicalScore: number; // 0-10
  optionsScore: number; // 0-10
  originalScore: number; // normalized confluence score
  originalMax: number; // normalized confluence max
  finalScore: number; // 0-100
  confidence: number; // 0-100
};

export type DVUTradeDecision = {
  // Disposition is the "what do we do" outcome (skip/paper/execute).
  disposition: 'SKIP' | 'PAPER' | 'EXECUTE';
  // Action is the trade side if we were to trade.
  action: 'BUY' | 'SELL' | 'HOLD';
  instrumentType: 'STOCK' | 'CALL' | 'PUT';
  optionStructure?: DVUOptionStructure;
  symbol: string;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  confidence: number;
  reasoning: string[];
  optionContract?: TradierOption;
  optionSpread?: DVUOptionSpread;
  optionLegs?: DVUOptionLeg[];
};

export type DVUValidationResult = {
  isValid: boolean;
  checks: Record<string, boolean>;
  failedChecks: string[];
};



