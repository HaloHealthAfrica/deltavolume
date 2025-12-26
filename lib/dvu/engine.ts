import type {
  AlpacaMarketStatus,
  DVUFullSignalPayload,
  DVUEnrichment,
  DVUTradeDecision,
  DVUValidationResult,
  DVUWebhookPayload,
  DVUScores,
  NormalizedSignal,
  TradierOption,
} from '@/lib/dvu/types';
import {
  fetchTradierBalances,
  fetchTradierOptions,
  fetchTradierPositions,
  fetchTradierQuote,
  placeTradierOptionBracketOrder,
  placeTradierStockBracketOrder,
} from '@/lib/dvu/integrations/tradier';
import { fetchTwelveDataIndicators } from '@/lib/dvu/integrations/twelvedata';
import { fetchAlpacaMarketStatus, fetchAlpacaQuote } from '@/lib/dvu/integrations/alpaca';

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

function isScannerPayload(payload: DVUWebhookPayload): payload is any {
  return Boolean((payload as any)?.scanner);
}

function asFullPayload(payload: DVUWebhookPayload): DVUFullSignalPayload | null {
  if (isScannerPayload(payload)) return null;
  const p = payload as any;
  if (p?.signal && p?.market && p?.price) return payload as DVUFullSignalPayload;
  return null;
}

export function normalizeWebhookPayload(payload: DVUWebhookPayload): NormalizedSignal {
  if (isScannerPayload(payload)) {
    const ticker = String((payload as any)?.signal?.ticker ?? '').trim().toUpperCase();
    const direction = (payload as any)?.signal?.direction;
    const timestamp = Number((payload as any)?.timestamp);
    const timeframeMinutes = Number((payload as any)?.signal?.trigger_tf ?? 5);

    const arrow = direction === 'SHORT' ? '↓' : '↑';
    const tfStrings: string[] = [
      (payload as any)?.strat?.tf1,
      (payload as any)?.strat?.tf2,
      (payload as any)?.strat?.tf3,
    ].filter((s: any) => typeof s === 'string' && s.length > 0);

    let confluenceScore = 0;
    let maxConfluence = 3;
    if (tfStrings.length) {
      confluenceScore = tfStrings.filter((s) => s.includes(arrow)).length;
      maxConfluence = tfStrings.length;
    } else if ((payload as any)?.conditions && typeof (payload as any).conditions === 'object') {
      const entries = Object.entries((payload as any).conditions as Record<string, boolean>);
      confluenceScore = entries.filter(([_, v]) => Boolean(v)).length;
      maxConfluence = Math.max(1, entries.length);
      // Scanner thresholds are defined as 2/3; normalize down to 3 if it's larger.
      if (maxConfluence > 3) {
        const ratio = confluenceScore / maxConfluence;
        maxConfluence = 3;
        confluenceScore = Math.round(ratio * 3);
      }
    }

    const qualityLabel = (payload as any)?.signal?.quality != null ? String((payload as any).signal.quality) : undefined;

    return {
      source: 'scanner',
      ticker,
      direction,
      timestamp,
      timeframeMinutes: Number.isFinite(timeframeMinutes) && timeframeMinutes > 0 ? timeframeMinutes : 5,
      confluenceScore: Number.isFinite(confluenceScore as any) ? confluenceScore : 0,
      maxConfluence: Number.isFinite(maxConfluence as any) ? maxConfluence : 3,
      qualityLabel,
      isLegendary: qualityLabel?.toUpperCase() === 'LEGENDARY',
      isMega: qualityLabel?.toUpperCase() === 'MEGA',
      raw: payload,
    };
  }

  // Full DVU signal
  const full = asFullPayload(payload);
  if (!full) {
    throw new Error('Unrecognized webhook payload shape');
  }

  return {
    source: 'full',
    ticker: String(full.market.ticker).trim().toUpperCase(),
    direction: full.signal.direction,
    timestamp: Number(full.market.timestamp),
    timeframeMinutes: Number(full.market.timeframe_minutes),
    confluenceScore: Number(full.signal.confluence_score ?? full.confluence?.total_score ?? 0),
    maxConfluence: Number(full.signal.max_confluence ?? 10),
    qualityLabel: full.signal.type,
    isLegendary: Boolean(full.signal.is_legendary),
    isMega: Boolean(full.signal.is_mega),
    entry: full.price?.entry,
    stopLoss: full.risk_management?.stop_loss,
    target1: full.risk_management?.target_1,
    target2: full.risk_management?.target_2,
    raw: payload,
  };
}

export function validateSignal(
  signal: NormalizedSignal,
  enrichment: DVUEnrichment,
  context?: { dailyTradeCount?: number }
): DVUValidationResult {
  const now = Date.now();
  const staleMs = numEnv('SIGNAL_MAX_AGE_MS', 2 * 60 * 1000);
  const isStale = Number.isFinite(signal.timestamp as any) ? now - signal.timestamp > staleMs : true;

  const minScanner = numEnv('MIN_CONFLUENCE_SCANNER', 2);
  const minFull = numEnv('MIN_CONFLUENCE_FULL', 5);
  const minConfluence = signal.source === 'scanner' ? minScanner : minFull;

  const dailyLimit = numEnv('DAILY_TRADE_LIMIT', 10);
  const dailyCount = context?.dailyTradeCount ?? 0;

  const minBuyingPower = numEnv('MIN_BUYING_POWER', 1000);
  const buyingPower = enrichment.tradierBalances?.buyingPower;

  const tradierEnabled = Boolean(process.env.TRADIER_API_KEY && process.env.TRADIER_ACCOUNT_ID);
  const alpacaEnabled = Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY);

  const hasPosition = tradierEnabled
    ? Boolean(enrichment.tradierPositions?.some((p) => p.symbol?.toUpperCase() === signal.ticker.toUpperCase()))
    : false;

  const checks = {
    hasRequiredFields: Boolean(signal.ticker && (signal.direction === 'LONG' || signal.direction === 'SHORT')),
    notStale: !isStale,
    marketOpen: alpacaEnabled ? Boolean(enrichment.marketStatus?.isOpen) : true,
    noExistingPosition: tradierEnabled ? !hasPosition : true,
    meetsMinConfluence: Number(signal.confluenceScore ?? 0) >= minConfluence,
    dailyTradeCountUnderLimit: dailyCount < dailyLimit,
    buyingPowerEnough: tradierEnabled ? typeof buyingPower === 'number' && buyingPower >= minBuyingPower : true,
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
  const signal = normalizeWebhookPayload(payload);
  const ticker = signal.ticker;
  const timeframe = signal.timeframeMinutes;

  const tradierEnabled = Boolean(process.env.TRADIER_API_KEY && process.env.TRADIER_ACCOUNT_ID);
  const twelveEnabled = Boolean(process.env.TWELVEDATA_API_KEY);
  const alpacaEnabled = Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY);

  const [tradierQuote, options, indicators, marketStatus, alpacaQuote, tradierBalances, tradierPositions] = await Promise.all([
    tradierEnabled ? fetchTradierQuote(ticker).catch(() => undefined) : Promise.resolve(undefined),
    tradierEnabled ? fetchTradierOptions(ticker).catch(() => undefined) : Promise.resolve(undefined),
    twelveEnabled ? fetchTwelveDataIndicators(ticker, timeframe).catch(() => undefined) : Promise.resolve(undefined),
    alpacaEnabled ? fetchAlpacaMarketStatus().catch(() => undefined) : Promise.resolve<AlpacaMarketStatus | undefined>(undefined),
    alpacaEnabled ? fetchAlpacaQuote(ticker).catch(() => undefined) : Promise.resolve(undefined),
    tradierEnabled ? fetchTradierBalances().catch(() => undefined) : Promise.resolve(undefined),
    tradierEnabled ? fetchTradierPositions().catch(() => undefined) : Promise.resolve(undefined),
  ]);

  const putCallRatio = calcPutCallRatio(options);
  const spreadPct = calcSpreadPct(tradierQuote);

  const ivValues = (options ?? [])
    .map((o) => o.greeks?.mid_iv ?? o.greeks?.iv)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const ivMin = ivValues.length ? Math.min(...ivValues) : undefined;
  const ivMax = ivValues.length ? Math.max(...ivValues) : undefined;
  const ivRank =
    typeof ivMin === 'number' && typeof ivMax === 'number' && ivMax > ivMin
      ? ((ivValues[Math.floor(ivValues.length / 2)] - ivMin) / (ivMax - ivMin)) * 100
      : undefined;

  return {
    tradierQuote,
    options,
    indicators,
    marketStatus,
    alpacaQuote,
    tradierBalances,
    tradierPositions,
    derived: { spreadPct, putCallRatio, ivRank },
  };
}

function currentPrice(signal: NormalizedSignal, enrichment: DVUEnrichment): number | undefined {
  const full = asFullPayload(signal.raw);
  return (
    enrichment.alpacaQuote?.last ??
    enrichment.tradierQuote?.last ??
    signal.entry ??
    full?.price?.close ??
    undefined
  );
}

export function calculateTechnicalScore(signal: NormalizedSignal, enrichment: DVUEnrichment): number {
  const direction = signal.direction;
  const price = currentPrice(signal, enrichment) ?? 0;
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

export function calculateOptionsScore(signal: NormalizedSignal, enrichment: DVUEnrichment): number {
  const direction = signal.direction;
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
  const signal = normalizeWebhookPayload(payload);
  const direction = signal.direction;
  const full = asFullPayload(payload);
  const price = enrichment.tradierQuote?.last ?? enrichment.alpacaQuote?.last ?? full?.price?.close ?? signal.entry ?? 0;
  const atr =
    enrichment.indicators?.atr ?? full?.levels?.atr ?? full?.risk_management?.atr_value ?? 0;
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
  signal: NormalizedSignal,
  payload: DVUWebhookPayload,
  option: TradierOption | null,
  maxRiskPerTradeFallback: number,
  maxPositionSizeFallback: number,
  enrichment: DVUEnrichment
): number {
  if (option) {
    const premium = option.ask * 100;
    if (!premium || premium <= 0) return 1;
    const buyingPower = enrichment.tradierBalances?.buyingPower;
    const maxRisk = maxRiskPerTradeFallback;
    const contractsFromRisk = Math.floor(maxRisk / premium);
    const contractsFromBP = typeof buyingPower === 'number' && buyingPower > 0 ? Math.floor(buyingPower / premium) : contractsFromRisk;
    return Math.max(1, Math.min(contractsFromRisk, contractsFromBP, 10));
  }

  const full = asFullPayload(payload);
  const entry = currentPrice(signal, enrichment) ?? full?.price?.close ?? 0;
  const stop = signal.stopLoss ?? full?.risk_management?.stop_loss;
  const riskPerShare = typeof stop === 'number' && entry > 0 ? Math.abs(entry - stop) : undefined;

  const maxRisk = maxRiskPerTradeFallback;
  const maxPosSize = maxPositionSizeFallback;

  const sharesFromRisk = typeof riskPerShare === 'number' && riskPerShare > 0 ? Math.floor(maxRisk / riskPerShare) : 1;
  const sharesFromSize = entry > 0 ? Math.floor(maxPosSize / entry) : 1;
  const buyingPower = enrichment.tradierBalances?.buyingPower;
  const sharesFromBP = typeof buyingPower === 'number' && entry > 0 ? Math.floor(buyingPower / entry) : sharesFromRisk;

  return Math.max(1, Math.min(sharesFromRisk, sharesFromSize, sharesFromBP));
}

export function calculateScores(signal: NormalizedSignal, enrichment: DVUEnrichment): DVUScores {
  const originalScore = Number(signal.confluenceScore ?? 0);
  const originalMax = Number(signal.maxConfluence ?? 10);
  const technicalScore = calculateTechnicalScore(signal, enrichment);
  const optionsScore = calculateOptionsScore(signal, enrichment);

  const confluencePct = originalMax > 0 ? (originalScore / originalMax) * 100 : 0;
  const technicalPct = (technicalScore / 10) * 100;
  const optionsPct = (optionsScore / 10) * 100;

  const confidence = Math.max(0, Math.min(confluencePct * 0.5 + technicalPct * 0.3 + optionsPct * 0.2, 100));
  const finalScore = confidence;

  return { technicalScore, optionsScore, originalScore, originalMax, finalScore, confidence };
}

function deriveRiskPlan(signal: NormalizedSignal, enrichment: DVUEnrichment): Pick<NormalizedSignal, 'entry' | 'stopLoss' | 'target1' | 'target2'> {
  const entry = signal.entry ?? currentPrice(signal, enrichment);
  const atr = enrichment.indicators?.atr;
  if (typeof entry !== 'number' || entry <= 0) return {};

  // If already present (full payload), keep it.
  if (typeof signal.stopLoss === 'number' && typeof signal.target1 === 'number' && typeof signal.target2 === 'number') {
    return { entry, stopLoss: signal.stopLoss, target1: signal.target1, target2: signal.target2 };
  }

  const atrRef = typeof atr === 'number' && atr > 0 ? atr : entry * 0.01;
  const stopMult = numEnv('SCANNER_ATR_STOP_MULT', 1.0);
  const t1Mult = numEnv('SCANNER_ATR_T1_MULT', 1.5);
  const t2Mult = numEnv('SCANNER_ATR_T2_MULT', 3.0);

  if (signal.direction === 'LONG') {
    return {
      entry,
      stopLoss: entry - atrRef * stopMult,
      target1: entry + atrRef * t1Mult,
      target2: entry + atrRef * t2Mult,
    };
  }
  return {
    entry,
    stopLoss: entry + atrRef * stopMult,
    target1: entry - atrRef * t1Mult,
    target2: entry - atrRef * t2Mult,
  };
}

function maxRiskPct(signal: NormalizedSignal): number {
  if (signal.isLegendary) return 0.02;
  if (signal.isMega) return 0.015;
  const q = (signal.qualityLabel ?? '').toUpperCase();
  if (q.includes('HIGH')) return 0.01;
  return 0.005;
}

export function makeDecision(signal: NormalizedSignal, enrichment: DVUEnrichment, scores: DVUScores): DVUTradeDecision {
  const direction = signal.direction;
  const confidence = scores.confidence;

  const disposition: DVUTradeDecision['disposition'] =
    confidence < 50 ? 'SKIP' : confidence < 65 ? 'PAPER' : 'EXECUTE';

  const action: DVUTradeDecision['action'] =
    disposition === 'SKIP' ? 'HOLD' : direction === 'LONG' ? 'BUY' : 'SELL';

  const riskPlan = deriveRiskPlan(signal, enrichment);
  const enrichedSignal: NormalizedSignal = { ...signal, ...riskPlan };

  const bestOption = selectBestOption(enrichedSignal.raw, enrichment);
  const useOptions =
    disposition === 'EXECUTE' &&
    Boolean(bestOption) &&
    Boolean(enrichedSignal.isLegendary || enrichedSignal.isMega) &&
    typeof enrichment.derived?.ivRank === 'number' &&
    enrichment.derived.ivRank < 50;

  const instrumentType: DVUTradeDecision['instrumentType'] = useOptions
    ? direction === 'LONG'
      ? 'CALL'
      : 'PUT'
    : 'STOCK';

  const equity = enrichment.tradierBalances?.equity;
  const maxRiskPerTradeFallback = numEnv('MAX_RISK_PER_TRADE', 500);
  const maxPositionSizeFallback = numEnv('MAX_POSITION_SIZE', 10000);
  const riskBudget = typeof equity === 'number' && equity > 0 ? equity * maxRiskPct(enrichedSignal) : maxRiskPerTradeFallback;
  const quantity =
    disposition === 'SKIP'
      ? 0
      : calculatePositionSize(
          enrichedSignal,
          enrichedSignal.raw,
          useOptions ? bestOption : null,
          riskBudget,
          maxPositionSizeFallback,
          enrichment
        );

  const entryPrice =
    (useOptions && bestOption?.ask && bestOption.ask > 0 ? bestOption.ask : undefined) ??
    enrichment.alpacaQuote?.last ??
    enrichment.tradierQuote?.last ??
    enrichedSignal.entry ??
    currentPrice(enrichedSignal, enrichment) ??
    0;

  const reasoning: string[] = [];
  reasoning.push(`Confluence: ${scores.originalScore}/${scores.originalMax}`);
  reasoning.push(`Technical score: ${scores.technicalScore.toFixed(1)}/10`);
  reasoning.push(`Options score: ${scores.optionsScore.toFixed(1)}/10`);
  reasoning.push(`Final confidence: ${confidence.toFixed(1)}%`);
  if (typeof enrichment.derived?.spreadPct === 'number') reasoning.push(`Spread: ${enrichment.derived.spreadPct.toFixed(2)}%`);
  const full = asFullPayload(enrichedSignal.raw);
  if (full?.strat?.patterns?.detected_name) reasoning.push(`Pattern: ${full.strat.patterns.detected_name}`);
  if (full?.ict?.amd_phase) reasoning.push(`AMD: ${full.ict.amd_phase}`);
  if (signal.source === 'scanner') reasoning.push('Risk plan: derived from ATR (scanner)');

  return {
    disposition,
    action,
    instrumentType,
    symbol: useOptions ? bestOption!.symbol : enrichedSignal.ticker,
    quantity,
    entryPrice,
    stopLoss: enrichedSignal.stopLoss ?? 0,
    target1: enrichedSignal.target1 ?? 0,
    target2: enrichedSignal.target2 ?? 0,
    confidence,
    reasoning,
    optionContract: useOptions ? bestOption ?? undefined : undefined,
  };
}

export async function executeDecision(signal: NormalizedSignal, enrichment: DVUEnrichment, decision: DVUTradeDecision) {
  if (decision.disposition !== 'EXECUTE') return { executed: false, reason: 'Not in EXECUTE disposition' };
  if (!(decision.action === 'BUY' || decision.action === 'SELL')) return { executed: false, reason: 'No trade action' };

  const enableAuto = boolEnv('ENABLE_AUTO_TRADING', false);
  if (!enableAuto) return { executed: false, reason: 'ENABLE_AUTO_TRADING disabled' };

  const tradierEnabled = Boolean(process.env.TRADIER_API_KEY && process.env.TRADIER_ACCOUNT_ID);
  if (!tradierEnabled) return { executed: false, reason: 'Tradier not configured (TRADIER_API_KEY/TRADIER_ACCOUNT_ID)' };

  // Basic bracket orders (best-effort fields; Tradier may reject depending on account config).
  if (decision.instrumentType === 'STOCK') {
    const side = signal.direction === 'LONG' ? 'buy' : 'sell_short';
    const res = await placeTradierStockBracketOrder({
      symbol: signal.ticker,
      side,
      quantity: decision.quantity,
      entryType: 'market',
      stopLoss: decision.stopLoss,
      takeProfit: decision.target1,
    });
    return { executed: true, order: res };
  }

  const opt = decision.optionContract;
  if (!opt) return { executed: false, reason: 'No option contract selected' };
  const res = await placeTradierOptionBracketOrder({
    optionSymbol: opt.symbol,
    quantity: decision.quantity,
    entryType: 'market',
    stopLoss: decision.stopLoss,
    takeProfit: decision.target1,
  });
  return { executed: true, order: res };
}

export async function processDVUWebhook(payload: DVUWebhookPayload, context?: { dailyTradeCount?: number }) {
  const signal = normalizeWebhookPayload(payload);
  const enrichment = await enrichSignal(payload);
  const scores = calculateScores(signal, enrichment);
  const decision = makeDecision(signal, enrichment, scores);
  const validation = validateSignal(signal, enrichment, context);

  const shouldExecute = boolEnv('ENABLE_AUTO_TRADING', false) && decision.disposition === 'EXECUTE';
  const execution = shouldExecute && validation.isValid ? await executeDecision(signal, enrichment, decision).catch((e) => ({ executed: false, error: e instanceof Error ? e.message : String(e) })) : undefined;

  return { signal, validation, enrichment, scores, decision, shouldExecute, execution };
}



