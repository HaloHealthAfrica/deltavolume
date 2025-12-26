import type { AlpacaMarketStatus } from '@/lib/dvu/types';

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


