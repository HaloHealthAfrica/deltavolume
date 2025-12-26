// components/recent-signals.tsx
import { kv } from '@vercel/kv';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTimeAgo } from '@/lib/utils';
import { CheckCircle, MinusCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export async function RecentSignals() {
  const kvConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (!kvConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-xl">📡</span>
            Recent Signals
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">
            Connect Vercel KV to start receiving signals
          </p>
        </CardContent>
      </Card>
    );
  }

  const signalIds = await kv.lrange('signals:list', 0, 4);
  const signals = await Promise.all(
    signalIds.map(async (id) => await kv.get(id as string))
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-xl">📡</span>
          Recent Signals
        </CardTitle>
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No signals yet
          </p>
        ) : (
          <div className="space-y-4">
            {signals.map((signal: any, i) => (
              (() => {
                const decision = String(signal?.decision ?? '');
                const isExecuted = decision === 'executed';
                const isHold = decision === 'hold' || decision === 'paper' || decision === 'approved';
                const isSkipped = decision === 'skipped';
                const borderClass = isExecuted
                  ? 'border-success/20 bg-success/5'
                  : isHold
                    ? 'border-warning/20 bg-warning/5'
                    : isSkipped
                      ? 'border-muted bg-muted/30'
                    : 'border-destructive/20 bg-destructive/5';

                const Icon = isExecuted ? CheckCircle : isHold ? MinusCircle : XCircle;
                const iconClass = isExecuted
                  ? 'text-success'
                  : isHold
                    ? 'text-warning'
                    : 'text-destructive';

                return (
              <div
                key={i}
                className={cn(
                  'flex items-center justify-between p-4 rounded-lg border',
                  borderClass
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn('h-5 w-5', iconClass)} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">
                        {signal.ticker}
                      </span>
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded',
                          signal.type?.includes('LONG')
                            ? 'bg-success/20 text-success'
                            : 'bg-destructive/20 text-destructive'
                        )}
                      >
                        {signal.type}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {signal.pattern} • {signal.quality}⭐ •{' '}
                      ${signal.entry?.toFixed(2)}
                    </p>
                    {signal.option?.expiration && signal.option?.strike != null && signal.option?.type && (
                      <p className="text-xs text-muted-foreground">
                        {String(signal.option.type).toUpperCase()} {signal.option.expiration} {signal.option.strike}
                        {signal.option?.greeks?.delta != null ? ` • Δ ${Number(signal.option.greeks.delta).toFixed(2)}` : ''}
                      </p>
                    )}
                    {signal.spread?.structure && signal.spread?.expiration && (
                      <p className="text-xs text-muted-foreground">
                        {String(signal.spread.structure).replaceAll('_', ' ')} • {signal.spread.expiration} • W {signal.spread.width}
                        {signal.spread.estimatedCredit != null ? ` • Credit ${Number(signal.spread.estimatedCredit).toFixed(2)}` : ''}
                        {signal.spread.estimatedDebit != null ? ` • Debit ${Number(signal.spread.estimatedDebit).toFixed(2)}` : ''}
                      </p>
                    )}
                    {signal.reason && (
                      <p
                        className={cn(
                          'text-xs mt-1',
                          decision === 'rejected' || decision === 'execute_failed'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        )}
                      >
                        {signal.reason}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">
                    {formatTimeAgo(signal.timestamp)}
                  </p>
                  {(() => {
                    const qty = Number(signal.quantity ?? signal.shares ?? 0);
                    if (!Number.isFinite(qty) || qty <= 0) return null;
                    const inst = String(signal.instrumentType ?? '');
                    const isOpt = inst === 'CALL' || inst === 'PUT' || Boolean(signal.option);
                    return (
                      <p className="text-sm font-medium">
                        {qty} {isOpt ? 'contract(s)' : 'shares'}
                      </p>
                    );
                  })()}
                </div>
              </div>
                );
              })()
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
