import type {
  AlpacaMarketStatus,
  DVUFullSignalPayload,
  DVUEnrichment,
  DVUOptionLeg,
  DVUOptionSpread,
  DVUOptionStructure,
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

function strEnv(name: string, fallback: string) {
  const raw = (process.env[name] ?? '').trim();
  return raw.length ? raw : fallback;
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

function optionMid(opt: TradierOption): number | undefined {
  const bid = Number(opt.bid);
  const ask = Number(opt.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid < 0 || ask <= 0) return undefined;
  return (bid + ask) / 2;
}

function optionSpreadPct(opt: TradierOption): number | undefined {
  const mid = optionMid(opt);
  if (!mid || mid <= 0) return undefined;
  return ((opt.ask - opt.bid) / mid) * 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseOptionStructures(raw: string): DVUOptionStructure[] {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return ['SINGLE'];
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  const out: DVUOptionStructure[] = [];
  for (const p of parts) {
    if (p === 'single') out.push('SINGLE');
    else if (p === 'call_debit' || p === 'call_debit_spread') out.push('CALL_DEBIT_SPREAD');
    else if (p === 'put_debit' || p === 'put_debit_spread') out.push('PUT_DEBIT_SPREAD');
    else if (p === 'call_credit' || p === 'call_credit_spread') out.push('CALL_CREDIT_SPREAD');
    else if (p === 'put_credit' || p === 'put_credit_spread') out.push('PUT_CREDIT_SPREAD');
    else if (p === 'auto') out.push('AUTO' as any);
  }
  // Expand AUTO to a preference list (IV-sensitive in makeDecision).
  if (out.includes('AUTO' as any)) {
    return ['CALL_CREDIT_SPREAD', 'PUT_CREDIT_SPREAD', 'CALL_DEBIT_SPREAD', 'PUT_DEBIT_SPREAD', 'SINGLE'];
  }
  return out.length ? out : ['SINGLE'];
}

function buildLegFromOption(opt: TradierOption, side: DVUOptionLeg['side'], quantity: number): DVUOptionLeg {
  return {
    optionSymbol: opt.symbol,
    side,
    quantity,
    expiration: opt.expiration,
    strike: opt.strike,
    optionType: opt.type,
    greeks: opt.greeks,
    bid: opt.bid,
    ask: opt.ask,
    last: opt.last,
  };
}

function estMid(opt: TradierOption): number | undefined {
  return optionMid(opt) ?? (Number.isFinite(opt.ask) && opt.ask > 0 ? opt.ask : undefined);
}

function findVerticalPartner(
  options: TradierOption[],
  base: TradierOption,
  params: {
    type: 'call' | 'put';
    expiration: string;
    direction: 'UP' | 'DOWN'; // strike direction for the partner leg
    targetDeltaAbs: number;
    minVol: number;
    minOI: number;
    maxSpreadPct: number;
  }
): TradierOption | null {
  const exp = params.expiration;
  const baseStrike = base.strike;
  const candidates = options
    .filter((o) => o.type === params.type && o.expiration === exp)
    .filter((o) => (params.direction === 'UP' ? o.strike > baseStrike : o.strike < baseStrike))
    .filter((o) => o.volume >= params.minVol && o.openInterest >= params.minOI)
    .filter((o) => {
      const sp = optionSpreadPct(o);
      return !(typeof sp === 'number' && sp > params.maxSpreadPct);
    })
    .map((o) => {
      const deltaAbs = o.greeks?.delta != null ? Math.abs(o.greeks.delta) : undefined;
      const deltaDist = typeof deltaAbs === 'number' ? Math.abs(deltaAbs - params.targetDeltaAbs) : 999;
      const strikeDist = Math.abs(o.strike - baseStrike);
      return { o, score: deltaDist * 10 + strikeDist };
    })
    .sort((a, b) => a.score - b.score);
  return candidates[0]?.o ?? null;
}

function buildVerticalSpread(
  structure: Exclude<DVUOptionStructure, 'SINGLE'>,
  base: TradierOption,
  all: TradierOption[],
  env: {
    minVol: number;
    minOI: number;
    maxSpreadPct: number;
    debitLongDeltaAbs: number;
    debitShortDeltaAbs: number;
    creditShortDeltaAbs: number;
    creditLongDeltaAbs: number;
  }
): DVUOptionSpread | null {
  const exp = base.expiration;
  const isCall = structure === 'CALL_DEBIT_SPREAD' || structure === 'CALL_CREDIT_SPREAD';
  const type: 'call' | 'put' = isCall ? 'call' : 'put';

  // Debit: buy nearer, sell further OTM (call UP, put DOWN)
  // Credit: sell nearer, buy further OTM (call UP, put DOWN)
  const strikeDir: 'UP' | 'DOWN' = isCall ? 'UP' : 'DOWN';

  if (structure === 'CALL_DEBIT_SPREAD' || structure === 'PUT_DEBIT_SPREAD') {
    // base = long leg
    const short = findVerticalPartner(all, base, {
      type,
      expiration: exp,
      direction: strikeDir,
      targetDeltaAbs: env.debitShortDeltaAbs,
      minVol: env.minVol,
      minOI: env.minOI,
      maxSpreadPct: env.maxSpreadPct,
    });
    if (!short) return null;
    const width = Math.abs(short.strike - base.strike);
    const longMid = estMid(base);
    const shortMid = estMid(short);
    const debit = typeof longMid === 'number' && typeof shortMid === 'number' ? Math.max(0, longMid - shortMid) : undefined;
    const maxLoss = typeof debit === 'number' ? debit * 100 : undefined;
    const maxProfit = typeof debit === 'number' ? (width - debit) * 100 : undefined;
    return {
      structure,
      expiration: exp,
      width,
      estimatedDebit: debit,
      estimatedMaxLoss: maxLoss,
      estimatedMaxProfit: typeof maxProfit === 'number' && Number.isFinite(maxProfit) ? maxProfit : undefined,
      longLeg: buildLegFromOption(base, 'buy_to_open', 1),
      shortLeg: buildLegFromOption(short, 'sell_to_open', 1),
    };
  }

  // Credit: base = short leg
  const long = findVerticalPartner(all, base, {
    type,
    expiration: exp,
    direction: strikeDir,
    targetDeltaAbs: env.creditLongDeltaAbs,
    minVol: env.minVol,
    minOI: env.minOI,
    maxSpreadPct: env.maxSpreadPct,
  });
  if (!long) return null;
  const width = Math.abs(base.strike - long.strike);
  const shortMid = estMid(base);
  const longMid = estMid(long);
  const credit = typeof shortMid === 'number' && typeof longMid === 'number' ? Math.max(0, shortMid - longMid) : undefined;
  const maxLoss = typeof credit === 'number' ? (width - credit) * 100 : undefined;
  const maxProfit = typeof credit === 'number' ? credit * 100 : undefined;
  return {
    structure,
    expiration: exp,
    width,
    estimatedCredit: credit,
    estimatedMaxLoss: typeof maxLoss === 'number' && Number.isFinite(maxLoss) ? maxLoss : undefined,
    estimatedMaxProfit: maxProfit,
    longLeg: buildLegFromOption(long, 'buy_to_open', 1),
    shortLeg: buildLegFromOption(base, 'sell_to_open', 1),
  };
}

function baseOptionForStructure(
  structure: Exclude<DVUOptionStructure, 'SINGLE'>,
  all: TradierOption[],
  fallback: TradierOption,
  env: {
    minVol: number;
    minOI: number;
    maxSpreadPct: number;
    debitLongDeltaAbs: number;
    creditShortDeltaAbs: number;
  }
): TradierOption {
  // Choose a sane "base" option for the structure so we can construct spreads
  // even when the signal direction doesn't match the option type.
  const exp = fallback.expiration;
  const wantsCall = structure === 'CALL_DEBIT_SPREAD' || structure === 'CALL_CREDIT_SPREAD';
  const type: 'call' | 'put' = wantsCall ? 'call' : 'put';
  const isDebit = structure === 'CALL_DEBIT_SPREAD' || structure === 'PUT_DEBIT_SPREAD';
  const targetDelta = isDebit ? env.debitLongDeltaAbs : env.creditShortDeltaAbs;

  const pool = all
    .filter((o) => o.type === type && o.expiration === exp)
    .filter((o) => o.volume >= env.minVol && o.openInterest >= env.minOI)
    .filter((o) => {
      const sp = optionSpreadPct(o);
      return !(typeof sp === 'number' && sp > env.maxSpreadPct);
    });
  if (!pool.length) return fallback;

  const best = pool
    .map((o) => {
      const d = o.greeks?.delta != null ? Math.abs(o.greeks.delta) : undefined;
      const dd = typeof d === 'number' ? Math.abs(d - targetDelta) : 999;
      // Prefer closer strikes as tie-breaker
      const strikeDist = Math.abs(o.strike - fallback.strike);
      return { o, score: dd * 10 + strikeDist * 0.01 };
    })
    .sort((a, b) => a.score - b.score)[0]?.o;

  return best ?? fallback;
}

export function selectBestOption(payload: DVUWebhookPayload, enrichment: DVUEnrichment): TradierOption | null {
  const signal = normalizeWebhookPayload(payload);
  const direction = signal.direction;
  const full = asFullPayload(payload);
  const price = enrichment.tradierQuote?.last ?? enrichment.alpacaQuote?.last ?? full?.price?.close ?? signal.entry ?? 0;
  const atr =
    enrichment.indicators?.atr ?? full?.levels?.atr ?? full?.risk_management?.atr_value ?? 0;
  const options = enrichment.options ?? [];

  const minDte = numEnv('OPTIONS_MIN_DTE', 7);
  const maxDte = numEnv('OPTIONS_MAX_DTE', 45);
  const minVol = numEnv('OPTIONS_MIN_VOLUME', 10);
  const minOI = numEnv('OPTIONS_MIN_OPEN_INTEREST', 100);
  const maxSpreadPct = numEnv('OPTIONS_MAX_SPREAD_PCT', 12);
  const minDelta = numEnv('OPTIONS_DELTA_MIN', 0.30);
  const maxDelta = numEnv('OPTIONS_DELTA_MAX', 0.65);
  const maxIv = numEnv('OPTIONS_MAX_IV', 2.0);

  const candidates = options
    .filter((o) => (direction === 'LONG' ? o.type === 'call' : o.type === 'put'))
    .filter((o) => {
      const dte = daysToExpiration(o.expiration);
      if (typeof dte === 'number' && (dte < minDte || dte > maxDte)) return false;
      if (o.volume < minVol) return false;
      if (o.openInterest < minOI) return false;
      const sp = optionSpreadPct(o);
      if (typeof sp === 'number' && sp > maxSpreadPct) return false;
      const deltaAbs = o.greeks?.delta != null ? Math.abs(o.greeks.delta) : undefined;
      if (typeof deltaAbs === 'number' && (deltaAbs < minDelta || deltaAbs > maxDelta)) return false;
      const iv = o.greeks?.mid_iv ?? o.greeks?.iv;
      if (typeof iv === 'number' && Number.isFinite(iv) && iv > maxIv) return false;
      return true;
    });
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

    // spread (relative to mid)
    const spreadPct = optionSpreadPct(opt);
    if (typeof spreadPct === 'number') {
      if (spreadPct < 5) score += 2;
      else if (spreadPct < 10) score += 1;
    }

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

    // IV (slight preference for lower IV when buying premium)
    const iv = opt.greeks?.mid_iv ?? opt.greeks?.iv;
    if (typeof iv === 'number' && Number.isFinite(iv)) {
      if (iv < 0.35) score += 1;
      else if (iv > 0.9) score -= 1;
    }

    return { opt, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.opt ?? null;
}

export function calculatePositionSize(
  signal: NormalizedSignal,
  payload: DVUWebhookPayload,
  optionOrSpread: { kind: 'SINGLE'; option: TradierOption } | { kind: 'SPREAD'; spread: DVUOptionSpread } | null,
  maxRiskPerTradeFallback: number,
  maxPositionSizeFallback: number,
  enrichment: DVUEnrichment
): number {
  if (optionOrSpread?.kind === 'SPREAD') {
    const maxLoss = optionOrSpread.spread.estimatedMaxLoss;
    if (typeof maxLoss !== 'number' || !Number.isFinite(maxLoss) || maxLoss <= 0) return 0;
    const buyingPower = enrichment.tradierBalances?.buyingPower;
    const maxRisk = maxRiskPerTradeFallback;
    const fromRisk = Math.floor(maxRisk / maxLoss);
    const fromBP = typeof buyingPower === 'number' && buyingPower > 0 ? Math.floor(buyingPower / maxLoss) : fromRisk;
    const maxSpreads = numEnv('OPTIONS_MAX_SPREADS', 10);
    return Math.max(0, Math.min(fromRisk, fromBP, maxSpreads));
  }

  if (optionOrSpread?.kind === 'SINGLE') {
    const option = optionOrSpread.option;
    const mid = optionMid(option);
    const price = (mid ?? option.ask) * 100;
    if (!price || price <= 0) return 0;

    // Risk model: worst-case is the premium paid, but we estimate risk to the underlying stop
    // using delta (and gamma if present) to avoid oversizing near-the-money.
    const full = asFullPayload(payload);
    const underlyingEntry =
      enrichment.alpacaQuote?.last ?? enrichment.tradierQuote?.last ?? signal.entry ?? full?.price?.close ?? 0;
    const underlyingStop = signal.stopLoss ?? full?.risk_management?.stop_loss;
    const move = typeof underlyingStop === 'number' && underlyingEntry > 0 ? Math.abs(underlyingEntry - underlyingStop) : undefined;

    const deltaAbs = option.greeks?.delta != null ? Math.abs(option.greeks.delta) : undefined;
    const gamma = option.greeks?.gamma;
    let estimatedLoss = price; // cap at premium
    if (typeof move === 'number' && move > 0 && typeof deltaAbs === 'number') {
      const deltaComponent = deltaAbs * 100 * move;
      const gammaComponent = typeof gamma === 'number' && Number.isFinite(gamma) ? 0.5 * Math.abs(gamma) * 100 * (move ** 2) : 0;
      estimatedLoss = Math.min(price, deltaComponent + gammaComponent);
    }

    const buyingPower = enrichment.tradierBalances?.buyingPower;
    const maxRisk = maxRiskPerTradeFallback;

    const contractsFromRisk = estimatedLoss > 0 ? Math.floor(maxRisk / estimatedLoss) : 0;
    const contractsFromBP = typeof buyingPower === 'number' && buyingPower > 0 ? Math.floor(buyingPower / price) : contractsFromRisk;
    const maxContracts = numEnv('OPTIONS_MAX_CONTRACTS', 10);
    return Math.max(0, Math.min(contractsFromRisk, contractsFromBP, maxContracts));
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
  const instrumentPref = strEnv('TRADE_INSTRUMENT', 'options').toLowerCase(); // options|stock
  const preferOptions = instrumentPref !== 'stock';
  const useOptions = Boolean(bestOption) && preferOptions;

  // Spread selection (verticals). This does NOT auto-execute yet, but the decision will include legs/spread metadata.
  const structuresRaw = strEnv('OPTIONS_STRUCTURES', 'auto,single');
  let structures = parseOptionStructures(structuresRaw);

  // IV-sensitive ordering when AUTO is present (we expanded it, now we prune for direction)
  const ivRank = enrichment.derived?.ivRank;
  if (typeof ivRank === 'number') {
    // If IV is high, prefer credit spreads first; if low, prefer debit spreads first.
    if (ivRank >= 60) {
      structures = ['CALL_CREDIT_SPREAD', 'PUT_CREDIT_SPREAD', 'CALL_DEBIT_SPREAD', 'PUT_DEBIT_SPREAD', 'SINGLE'];
    } else if (ivRank <= 40) {
      structures = ['CALL_DEBIT_SPREAD', 'PUT_DEBIT_SPREAD', 'CALL_CREDIT_SPREAD', 'PUT_CREDIT_SPREAD', 'SINGLE'];
    }
  }

  const spreadMinVol = numEnv('SPREAD_MIN_VOLUME', numEnv('OPTIONS_MIN_VOLUME', 10));
  const spreadMinOI = numEnv('SPREAD_MIN_OPEN_INTEREST', numEnv('OPTIONS_MIN_OPEN_INTEREST', 100));
  const spreadMaxPct = numEnv('SPREAD_MAX_SPREAD_PCT', numEnv('OPTIONS_MAX_SPREAD_PCT', 12));

  const debitLongDelta = clamp(numEnv('SPREAD_DEBIT_LONG_DELTA', 0.55), 0.05, 0.95);
  const debitShortDelta = clamp(numEnv('SPREAD_DEBIT_SHORT_DELTA', 0.25), 0.05, 0.95);
  const creditShortDelta = clamp(numEnv('SPREAD_CREDIT_SHORT_DELTA', 0.30), 0.05, 0.95);
  const creditLongDelta = clamp(numEnv('SPREAD_CREDIT_LONG_DELTA', 0.15), 0.05, 0.95);

  let selectedStructure: DVUOptionStructure | undefined = undefined;
  let optionSpread: DVUOptionSpread | null = null;
  let optionAnchor: TradierOption | null = null;

  if (useOptions && bestOption && enrichment.options?.length) {
    for (const s of structures) {
      if (s === 'SINGLE') {
        selectedStructure = 'SINGLE';
        optionAnchor = bestOption;
        break;
      }

      const base = baseOptionForStructure(s as any, enrichment.options, bestOption, {
        minVol: spreadMinVol,
        minOI: spreadMinOI,
        maxSpreadPct: spreadMaxPct,
        debitLongDeltaAbs: debitLongDelta,
        creditShortDeltaAbs: creditShortDelta,
      });

      const spread = buildVerticalSpread(s as any, base, enrichment.options, {
        minVol: spreadMinVol,
        minOI: spreadMinOI,
        maxSpreadPct: spreadMaxPct,
        debitLongDeltaAbs: debitLongDelta,
        debitShortDeltaAbs: debitShortDelta,
        creditShortDeltaAbs: creditShortDelta,
        creditLongDeltaAbs: creditLongDelta,
      });
      if (spread) {
        optionSpread = spread;
        selectedStructure = s;
        optionAnchor = base;
        break;
      }
    }
    if (!selectedStructure) selectedStructure = 'SINGLE';
    if (!optionAnchor) optionAnchor = bestOption;
  }

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
          useOptions && optionSpread
            ? { kind: 'SPREAD', spread: optionSpread }
            : useOptions && bestOption
              ? { kind: 'SINGLE', option: bestOption }
              : null,
          riskBudget,
          maxPositionSizeFallback,
          enrichment
        );

  const entryPrice =
    (useOptions && optionSpread?.estimatedDebit != null ? optionSpread.estimatedDebit : undefined) ??
    (useOptions && optionSpread?.estimatedCredit != null ? optionSpread.estimatedCredit : undefined) ??
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
  if (useOptions && optionAnchor) {
    const dte = daysToExpiration(optionAnchor.expiration);
    reasoning.push(
      `Option: ${optionAnchor.type.toUpperCase()} ${optionAnchor.expiration} ${optionAnchor.strike} (DTE ${typeof dte === 'number' ? dte : '—'})`
    );
    if (optionAnchor.greeks?.delta != null) reasoning.push(`Δ ${optionAnchor.greeks.delta.toFixed(3)}`);
    if (optionAnchor.greeks?.gamma != null) reasoning.push(`Γ ${optionAnchor.greeks.gamma.toFixed(4)}`);
    if (optionAnchor.greeks?.theta != null) reasoning.push(`Θ ${optionAnchor.greeks.theta.toFixed(4)}`);
    if (optionAnchor.greeks?.mid_iv != null || optionAnchor.greeks?.iv != null) {
      const iv = optionAnchor.greeks.mid_iv ?? optionAnchor.greeks.iv!;
      reasoning.push(`IV ${iv.toFixed(3)}`);
    }
    const sp = optionSpreadPct(optionAnchor);
    if (typeof sp === 'number') reasoning.push(`Opt spread ${sp.toFixed(2)}%`);
  }
  if (useOptions && optionSpread) {
    reasoning.push(`Structure: ${optionSpread.structure}`);
    if (typeof optionSpread.estimatedDebit === 'number') reasoning.push(`Est debit: ${optionSpread.estimatedDebit.toFixed(2)}`);
    if (typeof optionSpread.estimatedCredit === 'number') reasoning.push(`Est credit: ${optionSpread.estimatedCredit.toFixed(2)}`);
    if (typeof optionSpread.estimatedMaxLoss === 'number') reasoning.push(`Est max loss: $${optionSpread.estimatedMaxLoss.toFixed(0)}`);
    if (typeof optionSpread.estimatedMaxProfit === 'number') reasoning.push(`Est max profit: $${optionSpread.estimatedMaxProfit.toFixed(0)}`);
  }

  // If we can’t size at least 1 contract/share, don’t allow EXECUTE.
  const finalDisposition: DVUTradeDecision['disposition'] =
    disposition === 'EXECUTE' && quantity <= 0 ? 'PAPER' : disposition;
  if (finalDisposition !== disposition && disposition === 'EXECUTE') {
    reasoning.push('Auto-exec blocked: insufficient size for 1 contract within risk/buying power');
  }

  const optionLegs: DVUOptionLeg[] | undefined =
    useOptions && optionSpread
      ? [
          { ...optionSpread.longLeg, quantity },
          { ...optionSpread.shortLeg, quantity },
        ]
      : useOptions && optionAnchor
        ? [buildLegFromOption(optionAnchor, 'buy_to_open', quantity)]
        : undefined;

  return {
    disposition: finalDisposition,
    action,
    instrumentType,
    optionStructure: useOptions ? (selectedStructure ?? 'SINGLE') : undefined,
    symbol: useOptions ? (optionSpread ? optionAnchor?.underlying ?? enrichedSignal.ticker : optionAnchor!.symbol) : enrichedSignal.ticker,
    quantity,
    entryPrice,
    stopLoss: enrichedSignal.stopLoss ?? 0,
    target1: enrichedSignal.target1 ?? 0,
    target2: enrichedSignal.target2 ?? 0,
    confidence,
    reasoning,
    optionContract: useOptions ? optionAnchor ?? undefined : undefined,
    optionSpread: useOptions ? optionSpread ?? undefined : undefined,
    optionLegs,
  };
}

export async function executeDecision(signal: NormalizedSignal, enrichment: DVUEnrichment, decision: DVUTradeDecision) {
  if (decision.disposition !== 'EXECUTE') return { executed: false, reason: 'Not in EXECUTE disposition' };
  if (!(decision.action === 'BUY' || decision.action === 'SELL')) return { executed: false, reason: 'No trade action' };
  if (!Number.isFinite(decision.quantity) || decision.quantity <= 0) return { executed: false, reason: 'Quantity <= 0' };
  if (decision.optionLegs && decision.optionLegs.length > 1) {
    return { executed: false, reason: 'Multi-leg option spreads are not auto-executed yet (decision contains legs for future support)' };
  }

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



