import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatTimeAgo } from '@/lib/utils';
import type { AdminPositionRecord } from '@/lib/admin/kv-admin';

function n(v: unknown): number | null {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

export function OpenPositionsTable({ positions }: { positions: AdminPositionRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-xl">📌</span>
          Open Positions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No open positions</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Symbol</th>
                  <th className="py-2 text-left font-medium">Dir</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Entry</th>
                  <th className="py-2 text-right font-medium">Stop</th>
                  <th className="py-2 text-right font-medium">Target</th>
                  <th className="py-2 text-right font-medium">PnL</th>
                  <th className="py-2 text-right font-medium">Opened</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const pnl = n(p.unrealizedPnl) ?? n(p.realizedPnl);
                  const pnlText = pnl == null ? '—' : formatCurrency(pnl);
                  const pnlClass =
                    pnl == null ? 'text-muted-foreground' : pnl >= 0 ? 'text-success' : 'text-destructive';
                  return (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <td className="py-2 font-mono font-semibold">{p.symbol}</td>
                      <td className="py-2">
                        <span
                          className={
                            p.direction === 'LONG'
                              ? 'rounded bg-success/15 px-2 py-0.5 text-xs text-success'
                              : 'rounded bg-destructive/15 px-2 py-0.5 text-xs text-destructive'
                          }
                        >
                          {p.direction}
                        </span>
                      </td>
                      <td className="py-2 text-right">{p.quantity}</td>
                      <td className="py-2 text-right">{formatCurrency(p.entryPrice)}</td>
                      <td className="py-2 text-right">
                        {typeof p.stopLoss === 'number' ? formatCurrency(p.stopLoss) : '—'}
                      </td>
                      <td className="py-2 text-right">
                        {typeof p.target1 === 'number' ? formatCurrency(p.target1) : '—'}
                      </td>
                      <td className={`py-2 text-right ${pnlClass}`}>{pnlText}</td>
                      <td className="py-2 text-right text-muted-foreground">{formatTimeAgo(p.openedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


