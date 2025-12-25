// lib/decision-engine.ts
// Decision Engine - Ported from Python to TypeScript

export enum Strategy {
  MEGA_ONLY = 'mega_only',
  CONSERVATIVE = 'conservative',
  BALANCED = 'balanced',
  AGGRESSIVE = 'aggressive',
  REVERSAL_ONLY = 'reversal_only',
  MEAN_REVERSION = 'mean_reversion',
  SCALPING = 'scalping'
}

export interface WebhookData {
  signal: {
    type: string;
    quality: number;
    quality_stars: string;
  };
  market: {
    ticker: string;
    timeframe_minutes: number;
    timestamp: string;
  };
  price: {
    entry: number;
    body_percent: number;
  };
  volume: {
    z_score: number;
    vs_mean_percent: number;
    is_unusual: boolean;
  };
  structure: {
    trend: string;
    vwap: {
      distance_percent: number;
    };
    atr_levels: {
      at_key_level: boolean;
      nearest_level: number;
    };
  };
  strat: {
    current_candle: string;
    previous_candle: string;
    pattern: {
      name: string;
      detected: boolean;
      is_2_2_reversal?: boolean;
      is_3_reversal?: boolean;
    };
  };
  risk_management: {
    stop_loss: number;
    target_1: number;
    target_2: number;
    risk_amount: number;
    reward_amount: number;
    risk_reward_ratio: number;
  };
  confluence: {
    unusual_volume: boolean;
    trend_aligned: boolean;
    vwap_aligned: boolean;
    strat_pattern: boolean;
    at_atr_level: boolean;
    total_factors: number;
  };
}

export interface TradeDecision {
  execute: boolean;
  reason: string;
  action?: string;
  ticker?: string;
  entry?: number;
  stop?: number;
  target1?: number;
  target2?: number;
  shares?: number;
  sizeMultiplier?: number;
  pattern?: string;
  quality?: number;
  confidence?: string;
}

export interface DecisionEngineConfig {
  strategy: Strategy;
  riskPerTrade: number;
  maxRiskPerShare: number;
  minRRRatio: number;
  allowedTickers: string[];
  allowedTimeframes: number[];
}

export class DecisionEngine {
  private config: DecisionEngineConfig;

  constructor(config: DecisionEngineConfig) {
    this.config = config;
  }

  evaluate(data: WebhookData): TradeDecision {
    switch (this.config.strategy) {
      case Strategy.MEGA_ONLY:
        return this.megaOnlyStrategy(data);
      case Strategy.CONSERVATIVE:
        return this.conservativeStrategy(data);
      case Strategy.BALANCED:
        return this.balancedStrategy(data);
      case Strategy.AGGRESSIVE:
        return this.aggressiveStrategy(data);
      case Strategy.REVERSAL_ONLY:
        return this.reversalOnlyStrategy(data);
      case Strategy.MEAN_REVERSION:
        return this.meanReversionStrategy(data);
      case Strategy.SCALPING:
        return this.scalpingStrategy(data);
      default:
        return { execute: false, reason: 'Unknown strategy' };
    }
  }

  private megaOnlyStrategy(data: WebhookData): TradeDecision {
    // Base validation
    const baseCheck = this.validateBase(data);
    if (!baseCheck.valid) {
      return { execute: false, reason: baseCheck.reason };
    }

    // MEGA ONLY: Quality must be 5
    if (data.signal.quality !== 5) {
      return { execute: false, reason: 'Not 5-star quality' };
    }

    // Must be 2-2 reversal
    if (!data.strat.pattern.is_2_2_reversal) {
      return { execute: false, reason: 'Not 2-2 reversal pattern' };
    }

    // All confluence factors required
    if (data.confluence.total_factors < 5) {
      return { execute: false, reason: 'Missing confluence factors' };
    }

    // Risk/Reward > 1.5
    if (data.risk_management.risk_reward_ratio < 1.5) {
      return { execute: false, reason: `R:R ${data.risk_management.risk_reward_ratio.toFixed(2)} < 1.5` };
    }

    // Body percentage > 60%
    if (data.price.body_percent < 60) {
      return { execute: false, reason: 'Candle body too small' };
    }

    // Calculate position size with 2x multiplier for MEGA
    const shares = this.calculatePositionSize(data, 2.0);

    return {
      execute: true,
      reason: 'MEGA signal - all criteria met',
      action: data.signal.type,
      ticker: data.market.ticker,
      entry: data.price.entry,
      stop: data.risk_management.stop_loss,
      target1: data.risk_management.target_1,
      target2: data.risk_management.target_2,
      shares,
      sizeMultiplier: 2.0,
      pattern: data.strat.pattern.name,
      quality: data.signal.quality,
      confidence: 'MAXIMUM'
    };
  }

  private conservativeStrategy(data: WebhookData): TradeDecision {
    const baseCheck = this.validateBase(data);
    if (!baseCheck.valid) {
      return { execute: false, reason: baseCheck.reason };
    }

    // Quality >= 4
    if (data.signal.quality < 4) {
      return { execute: false, reason: 'Quality below 4 stars' };
    }

    // Confluence >= 4
    if (data.confluence.total_factors < 4) {
      return { execute: false, reason: 'Confluence < 4 factors' };
    }

    // Z-Score > 1.2
    if (data.volume.z_score < 1.2) {
      return { execute: false, reason: 'Volume Z-score too low' };
    }

    // VWAP distance < 0.5%
    if (Math.abs(data.structure.vwap.distance_percent) > 0.5) {
      return { execute: false, reason: 'Too far from VWAP' };
    }

    // R:R >= 1.3
    if (data.risk_management.risk_reward_ratio < 1.3) {
      return { execute: false, reason: `R:R ${data.risk_management.risk_reward_ratio.toFixed(2)} < 1.3` };
    }

    const multiplier = data.signal.quality === 5 ? 1.5 : 1.2;
    const shares = this.calculatePositionSize(data, multiplier);

    return {
      execute: true,
      reason: 'Conservative criteria met',
      action: data.signal.type,
      ticker: data.market.ticker,
      entry: data.price.entry,
      stop: data.risk_management.stop_loss,
      target1: data.risk_management.target_1,
      target2: data.risk_management.target_2,
      shares,
      sizeMultiplier: multiplier,
      pattern: data.strat.pattern.name,
      quality: data.signal.quality,
      confidence: 'HIGH'
    };
  }

  private balancedStrategy(data: WebhookData): TradeDecision {
    const baseCheck = this.validateBase(data);
    if (!baseCheck.valid) {
      return { execute: false, reason: baseCheck.reason };
    }

    // Quality >= 3
    if (data.signal.quality < 3) {
      return { execute: false, reason: 'Quality below 3 stars' };
    }

    // Confluence >= 3
    if (data.confluence.total_factors < 3) {
      return { execute: false, reason: 'Confluence < 3 factors' };
    }

    // Volume Z-score > 0.8
    if (data.volume.z_score < 0.8) {
      return { execute: false, reason: 'Volume too low' };
    }

    // VWAP distance < 1.0%
    if (Math.abs(data.structure.vwap.distance_percent) > 1.0) {
      return { execute: false, reason: 'Too far from VWAP' };
    }

    // Body > 50%
    if (data.price.body_percent < 50) {
      return { execute: false, reason: 'Weak candle' };
    }

    // R:R >= 1.0
    if (data.risk_management.risk_reward_ratio < 1.0) {
      return { execute: false, reason: `R:R ${data.risk_management.risk_reward_ratio.toFixed(2)} < 1.0` };
    }

    // Dynamic multiplier
    let multiplier = 1.0;
    if (data.signal.quality === 5) multiplier = 1.5;
    else if (data.signal.quality === 4) multiplier = 1.2;
    
    if (data.strat.pattern.is_2_2_reversal) multiplier *= 1.3;
    if (data.structure.atr_levels.at_key_level) multiplier *= 1.2;

    const shares = this.calculatePositionSize(data, multiplier);

    return {
      execute: true,
      reason: 'Balanced strategy approved',
      action: data.signal.type,
      ticker: data.market.ticker,
      entry: data.price.entry,
      stop: data.risk_management.stop_loss,
      target1: data.risk_management.target_1,
      target2: data.risk_management.target_2,
      shares,
      sizeMultiplier: multiplier,
      pattern: data.strat.pattern.name,
      quality: data.signal.quality,
      confidence: 'MEDIUM'
    };
  }

  private aggressiveStrategy(data: WebhookData): TradeDecision {
    const baseCheck = this.validateBase(data);
    if (!baseCheck.valid) {
      return { execute: false, reason: baseCheck.reason };
    }

    // Quality >= 2
    if (data.signal.quality < 2) {
      return { execute: false, reason: 'Quality too low' };
    }

    // Confluence >= 2
    if (data.confluence.total_factors < 2) {
      return { execute: false, reason: 'Insufficient confluence' };
    }

    // Volume + Trend required
    if (!data.confluence.unusual_volume) {
      return { execute: false, reason: 'No volume spike' };
    }
    if (!data.confluence.trend_aligned) {
      return { execute: false, reason: 'Trend not aligned' };
    }

    // R:R >= 0.8
    if (data.risk_management.risk_reward_ratio < 0.8) {
      return { execute: false, reason: `R:R ${data.risk_management.risk_reward_ratio.toFixed(2)} < 0.8` };
    }

    const shares = this.calculatePositionSize(data, 0.7); // Reduced size

    return {
      execute: true,
      reason: 'Aggressive strategy approved',
      action: data.signal.type,
      ticker: data.market.ticker,
      entry: data.price.entry,
      stop: data.risk_management.stop_loss,
      target1: data.risk_management.target_1,
      target2: data.risk_management.target_2,
      shares,
      sizeMultiplier: 0.7,
      pattern: data.strat.pattern.name,
      quality: data.signal.quality,
      confidence: 'LOW'
    };
  }

  private reversalOnlyStrategy(data: WebhookData): TradeDecision {
    const baseCheck = this.validateBase(data);
    if (!baseCheck.valid) {
      return { execute: false, reason: baseCheck.reason };
    }

    // MUST be 2-2 reversal
    if (!data.strat.pattern.is_2_2_reversal) {
      return { execute: false, reason: 'Not 2-2 reversal' };
    }

    // MUST be at ATR level
    if (!data.structure.atr_levels.at_key_level) {
      return { execute: false, reason: 'Not at key level' };
    }

    // Strong volume
    if (data.volume.z_score < 1.5) {
      return { execute: false, reason: 'Volume too weak' };
    }

    // Trend + VWAP aligned
    if (!data.confluence.trend_aligned || !data.confluence.vwap_aligned) {
      return { execute: false, reason: 'Structure not aligned' };
    }

    // Strong candle
    if (data.price.body_percent < 65) {
      return { execute: false, reason: 'Weak reversal candle' };
    }

    const shares = this.calculatePositionSize(data, 2.0);

    return {
      execute: true,
      reason: '2-2 reversal at key level',
      action: data.signal.type,
      ticker: data.market.ticker,
      entry: data.price.entry,
      stop: data.risk_management.stop_loss,
      target1: data.risk_management.target_1,
      target2: data.risk_management.target_2,
      shares,
      sizeMultiplier: 2.0,
      pattern: data.strat.pattern.name,
      quality: data.signal.quality,
      confidence: 'MAXIMUM'
    };
  }

  private meanReversionStrategy(data: WebhookData): TradeDecision {
    const baseCheck = this.validateBase(data);
    if (!baseCheck.valid) {
      return { execute: false, reason: baseCheck.reason };
    }

    // Must be at ATR level
    if (!data.structure.atr_levels.at_key_level) {
      return { execute: false, reason: 'Not at ATR level' };
    }

    // VWAP distance 0.2% - 1.0%
    const vwapDist = Math.abs(data.structure.vwap.distance_percent);
    if (vwapDist < 0.2 || vwapDist > 1.0) {
      return { execute: false, reason: `VWAP distance ${vwapDist.toFixed(2)}% out of range` };
    }

    // Volume confirmation
    if (data.volume.z_score < 1.0) {
      return { execute: false, reason: 'Insufficient volume' };
    }

    // Proper level for direction
    const isLong = data.signal.type.includes('LONG');
    const atSupport = data.structure.atr_levels.nearest_level < data.price.entry;
    const atResistance = data.structure.atr_levels.nearest_level > data.price.entry;

    if (isLong && !atSupport) {
      return { execute: false, reason: 'Long but not at support' };
    }
    if (!isLong && !atResistance) {
      return { execute: false, reason: 'Short but not at resistance' };
    }

    const shares = this.calculatePositionSize(data, 1.2);

    return {
      execute: true,
      reason: 'Mean reversion setup',
      action: data.signal.type,
      ticker: data.market.ticker,
      entry: data.price.entry,
      stop: data.risk_management.stop_loss,
      target1: data.risk_management.target_1,
      target2: data.risk_management.target_2,
      shares,
      sizeMultiplier: 1.2,
      pattern: data.strat.pattern.name,
      quality: data.signal.quality,
      confidence: 'HIGH'
    };
  }

  private scalpingStrategy(data: WebhookData): TradeDecision {
    const baseCheck = this.validateBase(data);
    if (!baseCheck.valid) {
      return { execute: false, reason: baseCheck.reason };
    }

    // Volume + Trend required
    if (!data.confluence.unusual_volume || !data.confluence.trend_aligned) {
      return { execute: false, reason: 'Volume or trend missing' };
    }

    // ATR distance < 0.75%
    const atrDist = Math.abs(data.structure.atr_levels.nearest_level - data.price.entry) / data.price.entry * 100;
    if (atrDist > 0.75) {
      return { execute: false, reason: 'Too far from level' };
    }

    // R:R >= 0.8 (quick trades)
    if (data.risk_management.risk_reward_ratio < 0.8) {
      return { execute: false, reason: `R:R ${data.risk_management.risk_reward_ratio.toFixed(2)} < 0.8` };
    }

    const shares = this.calculatePositionSize(data, 0.5); // Small size

    return {
      execute: true,
      reason: 'Scalp setup',
      action: data.signal.type,
      ticker: data.market.ticker,
      entry: data.price.entry,
      stop: data.risk_management.stop_loss,
      target1: data.risk_management.target_1,
      target2: data.risk_management.target_2,
      shares,
      sizeMultiplier: 0.5,
      pattern: data.strat.pattern.name,
      quality: data.signal.quality,
      confidence: 'LOW'
    };
  }

  private validateBase(data: WebhookData): { valid: boolean; reason: string } {
    // Global minimum R:R (configurable via env)
    if (this.config.minRRRatio > 0) {
      if (data.risk_management?.risk_reward_ratio < this.config.minRRRatio) {
        return {
          valid: false,
          reason: `R:R ${data.risk_management.risk_reward_ratio.toFixed(2)} < ${this.config.minRRRatio.toFixed(2)} (min)`,
        };
      }
    }

    // Ticker whitelist
    if (this.config.allowedTickers.length > 0) {
      if (!this.config.allowedTickers.includes(data.market.ticker)) {
        return { valid: false, reason: `Ticker ${data.market.ticker} not in whitelist` };
      }
    }

    // Timeframe filter
    if (this.config.allowedTimeframes.length > 0) {
      if (!this.config.allowedTimeframes.includes(data.market.timeframe_minutes)) {
        return { valid: false, reason: `Timeframe ${data.market.timeframe_minutes}m not allowed` };
      }
    }

    return { valid: true, reason: 'OK' };
  }

  private calculatePositionSize(data: WebhookData, multiplier: number): number {
    const riskPerShare = data.risk_management.risk_amount;
    
    // Safety cap
    if (riskPerShare > this.config.maxRiskPerShare) {
      return 0;
    }

    // Base calculation
    const baseShares = Math.floor(this.config.riskPerTrade / riskPerShare);
    
    // Apply multiplier
    const finalShares = Math.floor(baseShares * multiplier);
    
    return finalShares;
  }
}
