import type { TradierOption, TradierQuote } from '@/lib/dvu/types';

function baseUrl() {
  // Spec uses https://sandbox.tradier.com/v1 or https://api.tradier.com/v1
  return (process.env.TRADIER_BASE_URL || 'https://sandbox.tradier.com/v1').replace(/\/$/, '');
}

function headers() {
  const key = process.env.TRADIER_API_KEY;
  if (!key) throw new Error('Missing TRADIER_API_KEY');
  return {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
}

export async function fetchTradierQuote(ticker: string): Promise<TradierQuote> {
  const url = `${baseUrl()}/markets/quotes?symbols=${encodeURIComponent(ticker)}&greeks=true`;
  const res = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Tradier quote failed: ${res.status}`);
  const json = (await res.json()) as any;
  const q = json?.quotes?.quote;
  if (!q) throw new Error('Tradier quote missing');
  return {
    symbol: q.symbol,
    last: Number(q.last),
    bid: Number(q.bid),
    ask: Number(q.ask),
    volume: q.volume != null ? Number(q.volume) : undefined,
  };
}

export async function fetchTradierOptions(ticker: string): Promise<TradierOption[]> {
  // 1) expirations
  const expUrl = `${baseUrl()}/markets/options/expirations?symbol=${encodeURIComponent(ticker)}`;
  const expRes = await fetch(expUrl, { headers: headers(), cache: 'no-store' });
  if (!expRes.ok) throw new Error(`Tradier expirations failed: ${expRes.status}`);
  const expJson = (await expRes.json()) as any;
  const expirations: string[] = expJson?.expirations?.date || [];
  const expiration = expirations[0];
  if (!expiration) return [];

  // 2) chain (single expiration for now)
  const chainUrl = `${baseUrl()}/markets/options/chains?symbol=${encodeURIComponent(
    ticker
  )}&expiration=${encodeURIComponent(expiration)}&greeks=true`;
  const chainRes = await fetch(chainUrl, { headers: headers(), cache: 'no-store' });
  if (!chainRes.ok) throw new Error(`Tradier chain failed: ${chainRes.status}`);
  const chainJson = (await chainRes.json()) as any;
  const options = chainJson?.options?.option as any[] | undefined;
  if (!options?.length) return [];

  return options.map((o) => ({
    symbol: String(o.symbol),
    underlying: o.underlying ? String(o.underlying) : undefined,
    strike: Number(o.strike),
    expiration: String(o.expiration_date ?? o.expiration),
    type: String(o.option_type ?? o.type) === 'put' ? 'put' : 'call',
    bid: Number(o.bid),
    ask: Number(o.ask),
    last: Number(o.last),
    volume: Number(o.volume ?? 0),
    openInterest: Number(o.open_interest ?? 0),
    greeks: o.greeks
      ? {
          delta: Number(o.greeks.delta),
          gamma: o.greeks.gamma != null ? Number(o.greeks.gamma) : undefined,
          theta: Number(o.greeks.theta),
          vega: o.greeks.vega != null ? Number(o.greeks.vega) : undefined,
          rho: o.greeks.rho != null ? Number(o.greeks.rho) : undefined,
          iv: o.greeks.iv != null ? Number(o.greeks.iv) : undefined,
          mid_iv: o.greeks.mid_iv != null ? Number(o.greeks.mid_iv) : undefined,
        }
      : undefined,
  }));
}


