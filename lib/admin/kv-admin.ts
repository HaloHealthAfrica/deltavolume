import { kv } from '@vercel/kv';

export type AdminActivityEvent =
  | {
      ts: string;
      type: 'webhook_received';
      webhookId: string;
      ticker: string;
      direction?: string;
      source?: 'SCANNER' | 'DVU_FULL';
    }
  | {
      ts: string;
      type: 'decision_made';
      webhookId: string;
      decisionId: string;
      action: 'EXECUTE' | 'PAPER' | 'SKIP';
      ticker: string;
    }
  | {
      ts: string;
      type: 'position_opened';
      positionId: string;
      decisionId: string;
      webhookId: string;
      symbol: string;
      direction?: string;
      qty?: number;
    }
  | {
      ts: string;
      type: string;
      [k: string]: unknown;
    };

export type AdminPositionRecord = {
  id: string;
  openedAt: string;
  closedAt?: string;
  entryOrderId?: string;
  entryDecisionId: string;
  entryWebhookId: string;
  symbol: string;
  direction: string;
  quantity: number;
  entryPrice: number;
  currentPrice?: number;
  stopLoss?: number;
  target1?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  status: 'OPEN' | 'CLOSED' | string;
  exitPrice?: number;
  exitReason?: string;
  notes?: string;
  tags?: string[];
};

export type AdminWebhookRecord = {
  id: string;
  receivedAt: string;
  processed: boolean;
  source: 'SCANNER' | 'DVU_FULL';
  ticker: string;
  direction: string;
  quality: string;
  confluenceScore?: number;
  rawPayload: unknown;
};

export type AdminDecisionRecord = {
  id: string;
  createdAt: string;
  webhookId: string;
  action: 'EXECUTE' | 'PAPER' | 'SKIP';
  instrument: string;
  reason: string;
  finalConfidence?: number;
  enrichmentData?: unknown;
  outcome?: 'WIN' | 'LOSS' | 'MISSED_WIN' | 'AVOIDED_LOSS';
  outcomeNotes?: string;
};

export type AdminOrderRecord = {
  id: string;
  createdAt: string;
  decisionId: string;
  brokerOrderId?: string;
  symbol: string;
  optionSymbol?: string;
  side: string;
  quantity: number;
  filledPrice?: number;
  status: string;
};

export function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function utcDayStartMs(d = new Date()): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return Date.UTC(y, m, day, 0, 0, 0, 0);
}

export async function getAdminSummary() {
  const enabled = kvConfigured();
  if (!enabled) {
    return {
      enabled: false,
      today: { webhooks: 0, decisions: { EXECUTE: 0, PAPER: 0, SKIP: 0 }, openPositions: 0 },
    };
  }

  const startMs = utcDayStartMs();
  const endMs = Date.now();

  const [webhooksToday, openPositions, decisionIds] = await Promise.all([
    kv.zcount('admin:webhooks:by_received_at', startMs, endMs),
    kv.scard('admin:positions:open'),
    kv.zrange<string[]>('admin:decisions:by_created_at', startMs, endMs, { byScore: true }),
  ]);

  const decisions = await Promise.all(
    (decisionIds ?? []).map(async (id) => (await kv.get<AdminDecisionRecord>(`admin:decisions:${id}`)) ?? null)
  );

  const counts = { EXECUTE: 0, PAPER: 0, SKIP: 0 };
  for (const d of decisions) {
    if (!d) continue;
    if (d.action === 'EXECUTE') counts.EXECUTE += 1;
    else if (d.action === 'PAPER') counts.PAPER += 1;
    else if (d.action === 'SKIP') counts.SKIP += 1;
  }

  return {
    enabled: true,
    today: {
      webhooks: Number(webhooksToday ?? 0),
      decisions: counts,
      openPositions: Number(openPositions ?? 0),
    },
  };
}

export async function listOpenPositions(limit = 25): Promise<AdminPositionRecord[]> {
  if (!kvConfigured()) return [];

  // Pull most recent positions and filter down to OPEN.
  const ids = await kv.zrange<string[]>('admin:positions:by_opened_at', 0, Math.max(0, limit * 5 - 1), { rev: true });
  const positions = await Promise.all(
    (ids ?? []).map(async (id) => (await kv.get<AdminPositionRecord>(`admin:positions:${id}`)) ?? null)
  );
  return positions.filter((p): p is AdminPositionRecord => Boolean(p && p.status === 'OPEN')).slice(0, limit);
}

export async function getPosition(id: string): Promise<AdminPositionRecord | null> {
  if (!kvConfigured()) return null;
  return (await kv.get<AdminPositionRecord>(`admin:positions:${id}`)) ?? null;
}

export async function listPositions(args?: { status?: 'open' | 'closed' | 'all'; limit?: number }): Promise<AdminPositionRecord[]> {
  if (!kvConfigured()) return [];
  const status = args?.status ?? 'open';
  const limit = Math.max(1, Math.min(200, Math.trunc(args?.limit ?? 50)));

  const ids = await kv.zrange<string[]>('admin:positions:by_opened_at', 0, Math.max(0, limit * 10 - 1), { rev: true });
  const positions = await Promise.all(
    (ids ?? []).map(async (pid) => (await kv.get<AdminPositionRecord>(`admin:positions:${pid}`)) ?? null)
  );
  const filtered = positions.filter((p): p is AdminPositionRecord => Boolean(p)).filter((p) => {
    if (status === 'all') return true;
    if (status === 'open') return p.status === 'OPEN';
    return p.status === 'CLOSED';
  });
  return filtered.slice(0, limit);
}

export async function closePosition(id: string, args?: { exitReason?: string; exitPrice?: number; notes?: string }) {
  if (!kvConfigured()) throw new Error('KV not configured');
  const key = `admin:positions:${id}`;
  const pos = (await kv.get<AdminPositionRecord>(key)) ?? null;
  if (!pos) throw new Error('Position not found');

  if (pos.status === 'CLOSED') return pos;

  const closedAt = new Date().toISOString();
  const updated: AdminPositionRecord = {
    ...pos,
    status: 'CLOSED',
    closedAt,
    exitReason: args?.exitReason ?? pos.exitReason ?? 'MANUAL_CLOSE',
    exitPrice: typeof args?.exitPrice === 'number' ? args.exitPrice : pos.exitPrice,
    notes: args?.notes ?? pos.notes,
  };

  await Promise.all([
    kv.set(key, updated),
    kv.srem('admin:positions:open', id),
    kv.lpush(
      'admin:activity',
      JSON.stringify({
        ts: closedAt,
        type: 'position_closed',
        positionId: id,
        symbol: updated.symbol,
        reason: updated.exitReason,
      })
    ),
    kv.ltrim('admin:activity', 0, 499),
  ]);
  return updated;
}

export async function listAdminWebhooks(args?: {
  limit?: number;
  ticker?: string;
  source?: string;
  direction?: string;
  processed?: 'true' | 'false';
}): Promise<AdminWebhookRecord[]> {
  if (!kvConfigured()) return [];
  const limit = Math.max(1, Math.min(200, Math.trunc(args?.limit ?? 50)));
  const ticker = args?.ticker?.trim().toUpperCase();
  const source = args?.source?.trim().toUpperCase();
  const direction = args?.direction?.trim().toUpperCase();
  const processed = args?.processed;

  const ids = await kv.zrange<string[]>('admin:webhooks:by_received_at', 0, Math.max(0, limit * 10 - 1), { rev: true });
  const webhooks = await Promise.all(
    (ids ?? []).map(async (id) => (await kv.get<AdminWebhookRecord>(`admin:webhooks:${id}`)) ?? null)
  );

  const filtered = webhooks
    .filter((w): w is AdminWebhookRecord => Boolean(w))
    .filter((w) => (ticker ? w.ticker === ticker : true))
    .filter((w) => (source ? w.source === source : true))
    .filter((w) => (direction ? String(w.direction).toUpperCase() === direction : true))
    .filter((w) => (processed ? String(w.processed) === processed : true));

  return filtered.slice(0, limit);
}

export async function getWebhook(id: string): Promise<AdminWebhookRecord | null> {
  if (!kvConfigured()) return null;
  return (await kv.get<AdminWebhookRecord>(`admin:webhooks:${id}`)) ?? null;
}

export async function getDecision(id: string): Promise<AdminDecisionRecord | null> {
  if (!kvConfigured()) return null;
  return (await kv.get<AdminDecisionRecord>(`admin:decisions:${id}`)) ?? null;
}

export async function listDecisions(args?: { limit?: number; ticker?: string; action?: string }): Promise<AdminDecisionRecord[]> {
  if (!kvConfigured()) return [];
  const limit = Math.max(1, Math.min(200, Math.trunc(args?.limit ?? 50)));
  const action = args?.action?.trim().toUpperCase();

  const ids = await kv.zrange<string[]>('admin:decisions:by_created_at', 0, Math.max(0, limit * 10 - 1), { rev: true });
  const decisions = await Promise.all(
    (ids ?? []).map(async (id) => (await kv.get<AdminDecisionRecord>(`admin:decisions:${id}`)) ?? null)
  );
  const filtered = decisions
    .filter((d): d is AdminDecisionRecord => Boolean(d))
    .filter((d) => (action ? d.action === action : true));
  return filtered.slice(0, limit);
}

export async function listSignals(limit = 50): Promise<any[]> {
  if (!kvConfigured()) return [];
  const ids = await kv.lrange<string>('signals:list', 0, Math.max(0, limit - 1));
  const signals = await Promise.all((ids ?? []).map(async (id) => (await kv.get<any>(id)) ?? null));
  return signals.filter(Boolean);
}

export async function listActivity(limit = 50): Promise<AdminActivityEvent[]> {
  if (!kvConfigured()) return [];
  const raw = await kv.lrange<string>('admin:activity', 0, Math.max(0, limit - 1));
  const out: AdminActivityEvent[] = [];
  for (const s of raw ?? []) {
    try {
      out.push(JSON.parse(String(s)));
    } catch {
      // ignore bad entries
    }
  }
  return out;
}


