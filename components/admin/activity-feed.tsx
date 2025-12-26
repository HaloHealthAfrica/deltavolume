'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTimeAgo } from '@/lib/utils';

type ActivityEvent = {
  ts: string;
  type: string;
  [k: string]: any;
};

export function ActivityFeed({ initialEvents }: { initialEvents: ActivityEvent[] }) {
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => `Activity (${events.length})`, [events.length]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch('/api/admin/activity?limit=50', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { events: ActivityEvent[] };
        if (!alive) return;
        setEvents(Array.isArray(json.events) ? json.events : []);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    };

    const id = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-xl">🛰️</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {events.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No activity yet</p>
        ) : (
          <div className="space-y-2">
            {events.slice(0, 50).map((e, idx) => {
              const when = e.ts ? formatTimeAgo(e.ts) : '';
              const label =
                e.type === 'webhook_received'
                  ? `Webhook received: ${e.ticker ?? ''} ${e.direction ?? ''} (${e.source ?? ''})`
                  : e.type === 'decision_made'
                    ? `Decision: ${e.ticker ?? ''} → ${e.action ?? ''}`
                    : e.type === 'position_opened'
                      ? `Position opened: ${e.symbol ?? ''} ${e.direction ?? ''} x${e.qty ?? ''}`
                      : `${e.type}`;

              return (
                <div key={`${e.ts ?? 'ts'}_${idx}`} className="flex items-start justify-between gap-3 rounded-md border bg-card/50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{label}</p>
                    {(e.webhookId || e.decisionId || e.positionId) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {e.webhookId ? `wh:${e.webhookId} ` : ''}
                        {e.decisionId ? `dc:${e.decisionId} ` : ''}
                        {e.positionId ? `ps:${e.positionId}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">{when}</div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


