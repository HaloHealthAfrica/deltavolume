import type { TwelveDataIndicators } from '@/lib/dvu/types';

function key() {
  const k = process.env.TWELVEDATA_API_KEY;
  if (!k) throw new Error('Missing TWELVEDATA_API_KEY');
  return k;
}

function base() {
  return 'https://api.twelvedata.com';
}

async function fetchLatestNumber(path: string, field: string): Promise<number | undefined> {
  const res = await fetch(`${base()}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`TwelveData failed: ${res.status}`);
  const json = (await res.json()) as any;
  const v = json?.values?.[0]?.[field];
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function fetchTwelveDataIndicators(
  ticker: string,
  timeframeMinutes: number
): Promise<TwelveDataIndicators> {
  const interval = `${timeframeMinutes}min`;
  const apikey = key();

  const [
    rsi,
    atr,
    adx,
    stochK,
    stochD,
  ] = await Promise.all([
    fetchLatestNumber(`/rsi?symbol=${encodeURIComponent(ticker)}&interval=${interval}&time_period=14&apikey=${apikey}`, 'rsi').catch(
      () => undefined
    ),
    fetchLatestNumber(`/atr?symbol=${encodeURIComponent(ticker)}&interval=${interval}&time_period=14&apikey=${apikey}`, 'atr').catch(
      () => undefined
    ),
    fetchLatestNumber(`/adx?symbol=${encodeURIComponent(ticker)}&interval=${interval}&time_period=14&apikey=${apikey}`, 'adx').catch(
      () => undefined
    ),
    fetchLatestNumber(`/stoch?symbol=${encodeURIComponent(ticker)}&interval=${interval}&apikey=${apikey}`, 'k').catch(
      () => undefined
    ),
    fetchLatestNumber(`/stoch?symbol=${encodeURIComponent(ticker)}&interval=${interval}&apikey=${apikey}`, 'd').catch(
      () => undefined
    ),
  ]);

  // Bollinger bands needs special parsing
  const bb = await (async () => {
    try {
      const res = await fetch(
        `${base()}/bbands?symbol=${encodeURIComponent(ticker)}&interval=${interval}&time_period=20&apikey=${apikey}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return {};
      const json = (await res.json()) as any;
      const v = json?.values?.[0];
      const upper = v?.upper_band != null ? Number(v.upper_band) : undefined;
      const lower = v?.lower_band != null ? Number(v.lower_band) : undefined;
      const middle = v?.middle_band != null ? Number(v.middle_band) : undefined;
      return {
        bbUpper: Number.isFinite(upper as any) ? upper : undefined,
        bbLower: Number.isFinite(lower as any) ? lower : undefined,
        bbMiddle: Number.isFinite(middle as any) ? middle : undefined,
      };
    } catch {
      return {};
    }
  })();

  return { rsi, atr, adx, stochK, stochD, ...bb };
}


