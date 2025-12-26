import { kv } from '@vercel/kv';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatTimeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function badgeClasses(status: string) {
  switch (status) {
    case 'executed':
      return 'bg-success/20 text-success';
    case 'paper':
    case 'approved':
      return 'bg-warning/20 text-warning';
    case 'skipped':
      return 'bg-muted text-muted-foreground';
    case 'execute_failed':
      return 'bg-destructive/20 text-destructive';
    case 'rejected':
      return 'bg-destructive/20 text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export default async function SignalsPage() {
  const kvConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (!kvConfigured) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Signals</h1>
          <p className="text-muted-foreground">Signal history will appear here once KV is connected.</p>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            KV is not configured. Add `KV_REST_API_URL` and `KV_REST_API_TOKEN` in Vercel env vars and redeploy.
          </CardContent>
        </Card>
      </div>
    );
  }

  const ids = await kv.lrange<string>('signals:list', 0, 99);
  const signals = await Promise.all(ids.map(async (id) => ({ id, ...(await kv.get<any>(id)) })));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Signals</h1>
        <p className="text-muted-foreground">Latest webhook signals and the engine decision.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent</CardTitle>
        </CardHeader>
        <CardContent>
          {signals.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No signals yet.</div>
          ) : (
            <div className="space-y-3">
              {signals.map((s: any) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-4 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">{s.ticker ?? '—'}</span>
                      <span className={cn('text-xs px-2 py-0.5 rounded', badgeClasses(String(s.decision ?? '')))}>
                        {String(s.decision ?? 'unknown')}
                      </span>
                      {s.type && (
                        <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                          {s.type}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {s.pattern ? `${s.pattern} • ` : ''}
                      {typeof s.quality === 'number' ? `Confluence ${s.quality} • ` : ''}
                      {typeof s.confidence === 'number' ? `Confidence ${Number(s.confidence).toFixed(1)}%` : ''}
                    </div>
                    {s.reason && <div className="text-xs text-muted-foreground mt-1 truncate">{s.reason}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm text-muted-foreground">{formatTimeAgo(s.timestamp)}</div>
                    {typeof s.shares === 'number' && s.shares > 0 && (
                      <div className="text-sm font-medium">{s.shares} qty</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


