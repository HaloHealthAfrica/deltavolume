import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminSubnav } from '@/components/admin/admin-subnav';
import { kvConfigured, listDecisions } from '@/lib/admin/kv-admin';
import { formatTimeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminTradesPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const kvOk = kvConfigured();
  const search = await props.searchParams;
  const action = typeof search.action === 'string' ? search.action : undefined;

  if (!kvOk) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin • Trades</h1>
        <AdminSubnav />
        <Card>
          <CardHeader>
            <CardTitle>KV not configured</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">Connect Vercel KV to view trades.</CardContent>
        </Card>
      </div>
    );
  }

  const decisions = await listDecisions({ limit: 200, action });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin • Trades</h1>
        <p className="text-muted-foreground">Decision stream (`admin:decisions:*`)</p>
      </div>

      <AdminSubnav />

      <div className="flex gap-2">
        <a className="text-sm underline text-primary" href="/admin/trades">All</a>
        <a className="text-sm underline text-primary" href="/admin/trades?action=EXECUTE">EXECUTE</a>
        <a className="text-sm underline text-primary" href="/admin/trades?action=PAPER">PAPER</a>
        <a className="text-sm underline text-primary" href="/admin/trades?action=SKIP">SKIP</a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Decisions</CardTitle>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <p className="text-muted-foreground">No decisions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">When</th>
                    <th className="py-2 text-left font-medium">Action</th>
                    <th className="py-2 text-left font-medium">Instrument</th>
                    <th className="py-2 text-right font-medium">Confidence</th>
                    <th className="py-2 text-left font-medium">Reason</th>
                    <th className="py-2 text-left font-medium">Webhook</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id} className="border-b last:border-b-0">
                      <td className="py-2 text-muted-foreground">{formatTimeAgo(d.createdAt)}</td>
                      <td className="py-2 font-semibold">{d.action}</td>
                      <td className="py-2">{d.instrument}</td>
                      <td className="py-2 text-right">{d.finalConfidence ?? '—'}</td>
                      <td className="py-2 max-w-[520px] truncate" title={d.reason}>
                        {d.reason}
                      </td>
                      <td className="py-2">
                        <a className="text-primary underline" href={`/admin/webhooks/${d.webhookId}`}>
                          View
                        </a>
                      </td>
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


