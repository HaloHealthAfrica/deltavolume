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

export async function listActivity(limit = 50): Promise<AdminActivityEvent[]> {
  if (!kvConfigured()) return [];
  const raw = await kv.lrange<string[]>('admin:activity', 0, Math.max(0, limit - 1));
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


