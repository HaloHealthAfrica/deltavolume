import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminSubnav } from '@/components/admin/admin-subnav';
import { kvConfigured, listSignals } from '@/lib/admin/kv-admin';
import { formatTimeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminSignalsPage() {
  const kvOk = kvConfigured();
  if (!kvOk) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin • Signals</h1>
        <AdminSubnav />
        <Card>
          <CardHeader>
            <CardTitle>KV not configured</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">Connect Vercel KV to view signals.</CardContent>
        </Card>
      </div>
    );
  }

  const signals = await listSignals(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin • Signals</h1>
        <p className="text-muted-foreground">Existing dashboard signals (`signals:list`)</p>
      </div>

      <AdminSubnav />

      <Card>
        <CardHeader>
          <CardTitle>Recent Signals</CardTitle>
        </CardHeader>
        <CardContent>
          {signals.length === 0 ? (
            <p className="text-muted-foreground">No signals yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">When</th>
                    <th className="py-2 text-left font-medium">Ticker</th>
                    <th className="py-2 text-left font-medium">Type</th>
                    <th className="py-2 text-left font-medium">Decision</th>
                    <th className="py-2 text-right font-medium">Qty</th>
                    <th className="py-2 text-right font-medium">Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s: any, idx: number) => (
                    <tr key={idx} className="border-b last:border-b-0">
                      <td className="py-2 text-muted-foreground">{formatTimeAgo(s.timestamp ?? s.receivedAt ?? new Date().toISOString())}</td>
                      <td className="py-2 font-mono font-semibold">{s.ticker ?? '—'}</td>
                      <td className="py-2">{s.type ?? '—'}</td>
                      <td className="py-2">{s.decision ?? '—'}</td>
                      <td className="py-2 text-right">{s.quantity ?? s.shares ?? '—'}</td>
                      <td className="py-2 text-right">{typeof s.entry === 'number' ? s.entry.toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


