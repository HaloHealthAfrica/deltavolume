import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminSubnav } from '@/components/admin/admin-subnav';
import { kvConfigured, listPositions } from '@/lib/admin/kv-admin';
import { formatCurrency, formatTimeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminPositionsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const kvOk = kvConfigured();
  const search = await props.searchParams;
  const statusRaw = typeof search.status === 'string' ? search.status : 'open';
  const status = statusRaw === 'closed' ? 'closed' : statusRaw === 'all' ? 'all' : 'open';

  if (!kvOk) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin • Positions</h1>
        <AdminSubnav />
        <Card>
          <CardHeader>
            <CardTitle>KV not configured</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">Connect Vercel KV to view positions.</CardContent>
        </Card>
      </div>
    );
  }

  const positions = await listPositions({ status, limit: 100 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin • Positions</h1>
        <p className="text-muted-foreground">Trades from `admin:positions:*`</p>
      </div>

      <AdminSubnav />

      <div className="flex gap-2">
        <Link className="text-sm underline text-primary" href="/admin/positions?status=open">Open</Link>
        <Link className="text-sm underline text-primary" href="/admin/positions?status=closed">Closed</Link>
        <Link className="text-sm underline text-primary" href="/admin/positions?status=all">All</Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{status.toUpperCase()} Positions</CardTitle>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-muted-foreground">No positions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Symbol</th>
                    <th className="py-2 text-left font-medium">Dir</th>
                    <th className="py-2 text-right font-medium">Qty</th>
                    <th className="py-2 text-right font-medium">Entry</th>
                    <th className="py-2 text-right font-medium">PnL</th>
                    <th className="py-2 text-left font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Opened</th>
                    <th className="py-2 text-left font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const pnl = typeof p.unrealizedPnl === 'number' ? p.unrealizedPnl : p.realizedPnl;
                    return (
                      <tr key={p.id} className="border-b last:border-b-0">
                        <td className="py-2 font-mono font-semibold">{p.symbol}</td>
                        <td className="py-2">{p.direction}</td>
                        <td className="py-2 text-right">{p.quantity}</td>
                        <td className="py-2 text-right">{formatCurrency(p.entryPrice)}</td>
                        <td className={`py-2 text-right ${typeof pnl === 'number' ? (pnl >= 0 ? 'text-success' : 'text-destructive') : 'text-muted-foreground'}`}>
                          {typeof pnl === 'number' ? formatCurrency(pnl) : '—'}
                        </td>
                        <td className="py-2">{p.status}</td>
                        <td className="py-2 text-right text-muted-foreground">{formatTimeAgo(p.openedAt)}</td>
                        <td className="py-2">
                          <Link className="text-primary underline" href={`/admin/positions/${p.id}`}>
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


