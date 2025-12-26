import type { TradierBalances, TradierOption, TradierPosition, TradierQuote } from '@/lib/dvu/types';

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

function accountId() {
  const id = process.env.TRADIER_ACCOUNT_ID;
  if (!id) throw new Error('Missing TRADIER_ACCOUNT_ID');
  return id;
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

export async function fetchTradierBalances(): Promise<TradierBalances> {
  const url = `${baseUrl()}/user/balances`;
  const res = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Tradier balances failed: ${res.status}`);
  const json = (await res.json()) as any;
  const b = json?.balances;
  const equity =
    b?.total_equity != null ? Number(b.total_equity) : b?.account_balance?.total_equity != null ? Number(b.account_balance.total_equity) : undefined;
  const buyingPower =
    b?.buying_power != null ? Number(b.buying_power) : b?.account_balance?.buying_power != null ? Number(b.account_balance.buying_power) : undefined;
  const cash =
    b?.cash?.cash_available != null
      ? Number(b.cash.cash_available)
      : b?.cash?.available != null
        ? Number(b.cash.available)
        : undefined;

  return {
    accountNumber: b?.account_number ? String(b.account_number) : undefined,
    equity: Number.isFinite(equity as any) ? equity : undefined,
    buyingPower: Number.isFinite(buyingPower as any) ? buyingPower : undefined,
    cash: Number.isFinite(cash as any) ? cash : undefined,
  };
}

export async function fetchTradierPositions(): Promise<TradierPosition[]> {
  const url = `${baseUrl()}/accounts/${encodeURIComponent(accountId())}/positions`;
  const res = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Tradier positions failed: ${res.status}`);
  const json = (await res.json()) as any;
  const pos = json?.positions?.position;
  if (!pos) return [];
  const arr = Array.isArray(pos) ? pos : [pos];
  return arr
    .map((p: any) => ({
      symbol: String(p.symbol),
      quantity: Number(p.quantity ?? 0),
      costBasis: p.cost_basis != null ? Number(p.cost_basis) : undefined,
    }))
    .filter((p: TradierPosition) => p.symbol && Number.isFinite(p.quantity) && p.quantity !== 0);
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

export type TradierOrderResponse = {
  id?: string;
  status?: string;
  raw?: any;
};

async function postForm(path: string, body: Record<string, string | number | undefined>): Promise<any> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    form.set(k, String(v));
  }

  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`Tradier POST ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

export async function placeTradierStockBracketOrder(args: {
  symbol: string;
  side: 'buy' | 'sell_short';
  quantity: number;
  entryType: 'market' | 'limit';
  limitPrice?: number;
  stopLoss: number;
  takeProfit: number;
}): Promise<TradierOrderResponse> {
  // Tradier supports bracket-style orders via class=bracket (field names can vary by account type).
  // We send widely-used field names and return full payload for debugging if Tradier rejects.
  const json = await postForm(`/accounts/${encodeURIComponent(accountId())}/orders`, {
    class: 'bracket',
    symbol: args.symbol,
    side: args.side,
    quantity: args.quantity,
    type: args.entryType,
    duration: 'day',
    price: args.entryType === 'limit' ? args.limitPrice : undefined,
    // Common Tradier bracket keys (best-effort):
    'take_profit[price]': args.takeProfit,
    'stop_loss[stop]': args.stopLoss,
  } as any);

  return {
    id: json?.order?.id != null ? String(json.order.id) : undefined,
    status: json?.order?.status != null ? String(json.order.status) : undefined,
    raw: json,
  };
}

export async function placeTradierOptionBracketOrder(args: {
  optionSymbol: string;
  quantity: number;
  entryType: 'market' | 'limit';
  limitPrice?: number;
  stopLoss: number;
  takeProfit: number;
}): Promise<TradierOrderResponse> {
  const json = await postForm(`/accounts/${encodeURIComponent(accountId())}/orders`, {
    class: 'bracket',
    symbol: args.optionSymbol,
    side: 'buy_to_open',
    quantity: args.quantity,
    type: args.entryType,
    duration: 'day',
    price: args.entryType === 'limit' ? args.limitPrice : undefined,
    'take_profit[price]': args.takeProfit,
    'stop_loss[stop]': args.stopLoss,
  } as any);

  return {
    id: json?.order?.id != null ? String(json.order.id) : undefined,
    status: json?.order?.status != null ? String(json.order.status) : undefined,
    raw: json,
  };
}



