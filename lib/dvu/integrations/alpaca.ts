import type { AlpacaMarketStatus, AlpacaQuote } from '@/lib/dvu/types';

function baseUrl() {
  return (process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets').replace(/\/$/, '');
}

function headers() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) throw new Error('Missing ALPACA_API_KEY/ALPACA_SECRET_KEY');
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
  } as Record<string, string>;
}

export async function fetchAlpacaMarketStatus(): Promise<AlpacaMarketStatus> {
  const url = `${baseUrl()}/v2/clock`;
  const res = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Alpaca clock failed: ${res.status}`);
  const json = (await res.json()) as any;
  return {
    isOpen: Boolean(json?.is_open),
    timestamp: json?.timestamp ? String(json.timestamp) : undefined,
    nextOpen: json?.next_open ? String(json.next_open) : undefined,
    nextClose: json?.next_close ? String(json.next_close) : undefined,
  };
}

function dataBaseUrl() {
  // Market data endpoint base
  return (process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets').replace(/\/$/, '');
}

export async function fetchAlpacaQuote(symbol: string): Promise<AlpacaQuote> {
  const h = headers();

  const quotesUrl = `${dataBaseUrl()}/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`;
  const tradesUrl = `${dataBaseUrl()}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`;
  const barsUrl = `${dataBaseUrl()}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&limit=1`;

  const [quotesRes, tradesRes, barsRes] = await Promise.all([
    fetch(quotesUrl, { headers: h, cache: 'no-store' }).catch(() => undefined),
    fetch(tradesUrl, { headers: h, cache: 'no-store' }).catch(() => undefined),
    fetch(barsUrl, { headers: h, cache: 'no-store' }).catch(() => undefined),
  ]);

  const quoteJson = quotesRes && quotesRes.ok ? ((await quotesRes.json()) as any) : undefined;
  const tradeJson = tradesRes && tradesRes.ok ? ((await tradesRes.json()) as any) : undefined;
  const barsJson = barsRes && barsRes.ok ? ((await barsRes.json()) as any) : undefined;

  const bid = quoteJson?.quote?.bp != null ? Number(quoteJson.quote.bp) : undefined;
  const ask = quoteJson?.quote?.ap != null ? Number(quoteJson.quote.ap) : undefined;
  const last = tradeJson?.trade?.p != null ? Number(tradeJson.trade.p) : undefined;
  const dailyVolume = barsJson?.bars?.[0]?.v != null ? Number(barsJson.bars[0].v) : undefined;

  return {
    symbol,
    bid: Number.isFinite(bid as any) ? bid : undefined,
    ask: Number.isFinite(ask as any) ? ask : undefined,
    last: Number.isFinite(last as any) ? last : undefined,
    dailyVolume: Number.isFinite(dailyVolume as any) ? dailyVolume : undefined,
  };
}



