import type {
  AlpacaMarketStatus,
  DVUEnrichment,
  DVUTradeDecision,
  DVUValidationResult,
  DVUWebhookPayload,
  DVUScores,
  TradierOption,
} from '@/lib/dvu/types';
import { fetchTradierOptions, fetchTradierQuote } from '@/lib/dvu/integrations/tradier';
import { fetchTwelveDataIndicators } from '@/lib/dvu/integrations/twelvedata';
import { fetchAlpacaMarketStatus } from '@/lib/dvu/integrations/alpaca';

function numEnv(name: string, fallback: number) {
  const raw = process.env[name];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name: string, fallback: boolean) {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function validateSignal(payload: DVUWebhookPayload, minConfluenceScore: number): DVUValidationResult {
  const checks = {
    hasRequiredFields: Boolean(payload?.signal && payload?.market && payload?.price),
    meetsMinConfluence: Number(payload?.confluence?.total_score ?? 0) >= minConfluenceScore,
    isValidDirection: payload?.signal?.direction === 'LONG' || payload?.signal?.direction === 'SHORT',
    hasRiskManagement: Boolean(payload?.risk_management?.stop_loss),
  };

  return {
    isValid: Object.values(checks).every(Boolean),
    checks,
    failedChecks: Object.entries(checks)
      .filter(([_, v]) => !v)
      .map(([k]) => k),
  };
}

function calcPutCallRatio(options: TradierOption[] | undefined): number | undefined {
  if (!options?.length) return undefined;
  const calls = options.filter((o) => o.type === 'call');
  const puts = options.filter((o) => o.type === 'put');
  const callVol = calls.reduce((a, o) => a + (o.volume ?? 0), 0);
  const putVol = puts.reduce((a, o) => a + (o.volume ?? 0), 0);
  if (callVol <= 0) return undefined;
  return putVol / callVol;
}

function calcSpreadPct(quote: { bid: number; ask: number; last: number } | undefined): number | undefined {
  if (!quote) return undefined;
  if (!quote.last) return undefined;
  return ((quote.ask - quote.bid) / quote.last) * 100;
}

export async function enrichSignal(payload: DVUWebhookPayload): Promise<DVUEnrichment> {
  const ticker = payload.market.ticker;
  const timeframe = payload.market.timeframe_minutes;

  const tradierEnabled = Boolean(process.env.TRADIER_API_KEY);
  const twelveEnabled = Boolean(process.env.TWELVEDATA_API_KEY);
  const alpacaEnabled = Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY);

  const [tradierQuote, options, indicators, marketStatus] = await Promise.all([
    tradierEnabled ? fetchTradierQuote(ticker).catch(() => undefined) : Promise.resolve(undefined),
    tradierEnabled ? fetchTradierOptions(ticker).catch(() => undefined) : Promise.resolve(undefined),
    twelveEnabled ? fetchTwelveDataIndicators(ticker, timeframe).catch(() => undefined) : Promise.resolve(undefined),
    alpacaEnabled ? fetchAlpacaMarketStatus().catch(() => undefined) : Promise.resolve<AlpacaMarketStatus | undefined>(undefined),
  ]);

  const putCallRatio = calcPutCallRatio(options);
  const spreadPct = calcSpreadPct(tradierQuote);

  // ivRank needs historical IV; placeholder until we track it in KV.
  const ivRank = undefined;

  return {
    tradierQuote,
    options,
    indicators,
    marketStatus,
    derived: { spreadPct, putCallRatio, ivRank },
  };
}

export function calculateTechnicalScore(payload: DVUWebhookPayload, enrichment: DVUEnrichment): number {
  const direction = payload.signal.direction;
  const price = payload.price.close;
  const rsi = enrichment.indicators?.rsi;
  const adx = enrichment.indicators?.adx;
  const stochK = enrichment.indicators?.stochK;
  const stochD = enrichment.indicators?.stochD;
  const bbUpper = enrichment.indicators?.bbUpper;
  const bbLower = enrichment.indicators?.bbLower;

  let score = 0;

  // RSI (0-4)
  if (typeof rsi === 'number') {
    if (direction === 'LONG') {
      if (rsi >= 30 && rsi <= 50) score += 2;
      else if (rsi > 50 && rsi <= 70) score += 1;
    } else {
      if (rsi >= 50 && rsi <= 70) score += 2;
      else if (rsi >= 30 && rsi < 50) score += 1;
    }
  }

  // ADX (0-2)
  if (typeof adx === 'number') {
    if (adx > 25) score += 2;
    else if (adx > 20) score += 1;
  }

  // Stoch (0-2)
  if (typeof stochK === 'number' && typeof stochD === 'number') {
    if (direction === 'LONG') {
      if (stochK < 30 && stochK > stochD) score += 2;
      else if (stochK < 50) score += 1;
    } else {
      if (stochK > 70 && stochK < stochD) score += 2;
      else if (stochK > 50) score += 1;
    }
  }

  // Bollinger (0-2)
  if (typeof bbUpper === 'number' && typeof bbLower === 'number') {
    if (direction === 'LONG' && price <= bbLower * 1.02) score += 2;
    else if (direction === 'SHORT' && price >= bbUpper * 0.98) score += 2;
  }

  return Math.min(score, 10);
}

export function calculateOptionsScore(payload: DVUWebhookPayload, enrichment: DVUEnrichment): number {
  const direction = payload.signal.direction;
  const options = enrichment.options ?? [];
  const putCallRatio = enrichment.derived?.putCallRatio;
  const ivRank = enrichment.derived?.ivRank;

  let score = 0;

  // IV Rank (0-2) - placeholder unless we have it
  if (typeof ivRank === 'number') {
    if (ivRank < 30) score += 2;
    else if (ivRank < 50) score += 1;
    else if (ivRank > 70) score -= 1;
  }

  // Put/Call Ratio (0-2)
  if (typeof putCallRatio === 'number') {
    if (direction === 'LONG' && putCallRatio > 1.2) score += 2;
    else if (direction === 'SHORT' && putCallRatio < 0.8) score += 2;
  }

  // Liquidity + greeks (0-6) approx
  const candidates = options.filter((o) => (direction === 'LONG' ? o.type === 'call' : o.type === 'put'));
  const best = candidates
    .map((o) => {
      let s = 0;
      if (o.volume > 100) s += 1;
      if (o.openInterest > 1000) s += 1;
      const spread = o.ask > 0 ? (o.ask - o.bid) / o.ask : 1;
      if (spread < 0.05) s += 2;
      else if (spread < 0.1) s += 1;
      const delta = o.greeks?.delta != null ? Math.abs(o.greeks.delta) : undefined;
      if (typeof delta === 'number') {
        if (delta >= 0.4 && delta <= 0.6) s += 2;
        else if (delta >= 0.3 && delta <= 0.7) s += 1;
      }
      return { o, s };
    })
    .sort((a, b) => b.s - a.s)[0];

  score += best?.s ?? 0;

  return Math.max(0, Math.min(score, 10));
}

function daysToExpiration(exp: string): number | undefined {
  const d = new Date(exp);
  if (Number.isNaN(d.getTime())) return undefined;
  const diff = d.getTime() - Date.now();
  return Math.floor(diff / 86400000);
}

export function selectBestOption(payload: DVUWebhookPayload, enrichment: DVUEnrichment): TradierOption | null {
  const direction = payload.signal.direction;
  const price = enrichment.tradierQuote?.last ?? payload.price.close;
  const atr = payload.levels?.atr ?? payload.risk_management.atr_value ?? 0;
  const options = enrichment.options ?? [];

  const candidates = options.filter((o) => (direction === 'LONG' ? o.type === 'call' : o.type === 'put'));
  if (!candidates.length) return null;

  const scored = candidates.map((opt) => {
    let score = 0;

    // strike preference
    const strikeDiff = Math.abs(opt.strike - price);
    const atrRef = atr || (price * 0.005); // fallback ~0.5%
    if (strikeDiff < atrRef * 0.5) score += 3;
    else if (strikeDiff < atrRef) score += 2;
    else if (strikeDiff < atrRef * 1.5) score += 1;

    // liquidity
    if (opt.volume > 100) score += 2;
    if (opt.openInterest > 500) score += 2;

    // spread
    const spread = opt.ask > 0 ? (opt.ask - opt.bid) / opt.ask : 1;
    if (spread < 0.05) score += 2;
    else if (spread < 0.1) score += 1;

    // greeks
    const delta = opt.greeks?.delta != null ? Math.abs(opt.greeks.delta) : undefined;
    if (typeof delta === 'number') {
      if (delta >= 0.4 && delta <= 0.6) score += 2;
      else if (delta >= 0.3 && delta <= 0.7) score += 1;
    }
    if (typeof opt.greeks?.theta === 'number' && opt.greeks.theta > -0.10) score += 1;

    // expiration (prefer 14-30 days)
    const dte = daysToExpiration(opt.expiration);
    if (typeof dte === 'number') {
      if (dte >= 14 && dte <= 30) score += 2;
      else if (dte >= 7 && dte <= 45) score += 1;
    }

    return { opt, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.opt ?? null;
}

export function calculatePositionSize(
  payload: DVUWebhookPayload,
  option: TradierOption | null,
  maxRiskPerTrade: number,
  maxPositionSize: number
): number {
  if (option) {
    const premium = option.ask * 100;
    if (!premium || premium <= 0) return 1;
    const contracts = Math.floor(maxRiskPerTrade / premium);
    return Math.max(1, Math.min(contracts, 10));
  }

  const riskPerShare = payload.risk_management.risk_amount;
  const sharesFromRisk = riskPerShare > 0 ? Math.floor(maxRiskPerTrade / riskPerShare) : 1;
  const sharesFromSize = payload.price.close > 0 ? Math.floor(maxPositionSize / payload.price.close) : 1;
  return Math.max(1, Math.min(sharesFromRisk, sharesFromSize));
}

export function calculateScores(payload: DVUWebhookPayload, enrichment: DVUEnrichment): DVUScores {
  const originalScore = Number(payload.confluence?.total_score ?? 0);
  const technicalScore = calculateTechnicalScore(payload, enrichment);
  const optionsScore = calculateOptionsScore(payload, enrichment);
  const finalScore = (originalScore / 8) * 50 + technicalScore * 3 + optionsScore * 2;
  const confidence = Math.min(Math.max(finalScore, 0), 100);
  return { technicalScore, optionsScore, originalScore, finalScore, confidence };
}

export function makeDecision(payload: DVUWebhookPayload, enrichment: DVUEnrichment, scores: DVUScores): DVUTradeDecision {
  const direction = payload.signal.direction;
  const confidence = scores.confidence;

  let action: DVUTradeDecision['action'] = 'HOLD';
  if (confidence >= 70) action = direction === 'LONG' ? 'BUY' : 'SELL';
  else if (confidence >= 50) action = direction === 'LONG' ? 'BUY' : 'SELL';

  const bestOption = selectBestOption(payload, enrichment);
  const instrumentType: DVUTradeDecision['instrumentType'] = bestOption
    ? direction === 'LONG'
      ? 'CALL'
      : 'PUT'
    : 'STOCK';

  const maxRiskPerTrade = numEnv('MAX_RISK_PER_TRADE', 500);
  const maxPositionSize = numEnv('MAX_POSITION_SIZE', 10000);
  const quantity = calculatePositionSize(payload, bestOption, maxRiskPerTrade, maxPositionSize);

  const entryPrice =
    (bestOption?.ask && bestOption.ask > 0 ? bestOption.ask : undefined) ??
    enrichment.tradierQuote?.last ??
    payload.price.close;

  const reasoning: string[] = [];
  reasoning.push(`Original confluence: ${scores.originalScore}/8`);
  reasoning.push(`Technical score: ${scores.technicalScore.toFixed(1)}/10`);
  reasoning.push(`Options score: ${scores.optionsScore.toFixed(1)}/10`);
  if (typeof enrichment.derived?.spreadPct === 'number') reasoning.push(`Spread: ${enrichment.derived.spreadPct.toFixed(2)}%`);
  if (payload.strat?.patterns?.detected_name) reasoning.push(`Pattern: ${payload.strat.patterns.detected_name}`);
  if (payload.ict?.amd_phase) reasoning.push(`AMD: ${payload.ict.amd_phase}`);

  return {
    action,
    instrumentType,
    symbol: bestOption?.symbol || payload.market.ticker,
    quantity,
    entryPrice,
    stopLoss: payload.risk_management.stop_loss,
    target1: payload.risk_management.target_1,
    target2: payload.risk_management.target_2,
    confidence,
    reasoning,
    optionContract: bestOption ?? undefined,
  };
}

export async function processDVUWebhook(payload: DVUWebhookPayload) {
  const minConfluence = numEnv('MIN_CONFLUENCE_SCORE', 5);
  const validation = validateSignal(payload, minConfluence);
  const enrichment = await enrichSignal(payload);
  const scores = calculateScores(payload, enrichment);
  const decision = makeDecision(payload, enrichment, scores);

  const enableAuto = boolEnv('ENABLE_AUTO_TRADING', false);
  const shouldExecute = enableAuto && (decision.action === 'BUY' || decision.action === 'SELL');

  return { validation, enrichment, scores, decision, shouldExecute };
}


