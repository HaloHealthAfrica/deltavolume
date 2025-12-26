export type DVUDirection = 'LONG' | 'SHORT';

export interface DVUWebhookPayload {
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

export type TradierQuote = {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  volume?: number;
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

export type DVUEnrichment = {
  tradierQuote?: TradierQuote;
  options?: TradierOption[];
  indicators?: TwelveDataIndicators;
  marketStatus?: AlpacaMarketStatus;
  derived?: {
    spreadPct?: number;
    putCallRatio?: number;
    ivRank?: number; // placeholder: needs history to compute properly
  };
};

export type DVUScores = {
  technicalScore: number; // 0-10
  optionsScore: number; // 0-10
  originalScore: number; // 0-8
  finalScore: number; // 0-100
  confidence: number; // 0-100
};

export type DVUTradeDecision = {
  action: 'BUY' | 'SELL' | 'HOLD' | 'SKIP';
  instrumentType: 'STOCK' | 'CALL' | 'PUT';
  symbol: string;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  confidence: number;
  reasoning: string[];
  optionContract?: TradierOption;
};

export type DVUValidationResult = {
  isValid: boolean;
  checks: Record<string, boolean>;
  failedChecks: string[];
};


