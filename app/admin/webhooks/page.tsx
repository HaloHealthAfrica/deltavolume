import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminSubnav } from '@/components/admin/admin-subnav';
import { listAdminWebhooks, kvConfigured } from '@/lib/admin/kv-admin';
import { formatTimeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminWebhooksPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const kvOk = kvConfigured();
  if (!kvOk) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin • Webhooks</h1>
        <AdminSubnav />
        <Card>
          <CardHeader>
            <CardTitle>KV not configured</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">Connect Vercel KV to view admin webhooks.</CardContent>
        </Card>
      </div>
    );
  }

  // Simple filters via query string
  const searchParams = await props.searchParams;
  const ticker = typeof searchParams.ticker === 'string' ? searchParams.ticker : undefined;
  const source = typeof searchParams.source === 'string' ? searchParams.source : undefined;
  const direction = typeof searchParams.direction === 'string' ? searchParams.direction : undefined;
  const processed = typeof searchParams.processed === 'string' ? (searchParams.processed as any) : undefined;

  const webhooks = await listAdminWebhooks({ limit: 100, ticker, source, direction, processed });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin • Webhooks</h1>
        <p className="text-muted-foreground">Incoming TradingView payloads (from `admin:webhooks:*`)</p>
      </div>

      <AdminSubnav />

      <Card>
        <CardHeader>
          <CardTitle>Recent Webhooks</CardTitle>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-muted-foreground">No webhooks found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">When</th>
                    <th className="py-2 text-left font-medium">Ticker</th>
                    <th className="py-2 text-left font-medium">Dir</th>
                    <th className="py-2 text-left font-medium">Source</th>
                    <th className="py-2 text-right font-medium">Confluence</th>
                    <th className="py-2 text-left font-medium">Processed</th>
                    <th className="py-2 text-left font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((w) => (
                    <tr key={w.id} className="border-b last:border-b-0">
                      <td className="py-2 text-muted-foreground">{formatTimeAgo(w.receivedAt)}</td>
                      <td className="py-2 font-mono font-semibold">{w.ticker}</td>
                      <td className="py-2">{w.direction}</td>
                      <td className="py-2">{w.source}</td>
                      <td className="py-2 text-right">{typeof w.confluenceScore === 'number' ? w.confluenceScore : '—'}</td>
                      <td className="py-2">{w.processed ? '✅' : '⏳'}</td>
                      <td className="py-2">
                        <Link className="text-primary underline" href={`/admin/webhooks/${w.id}`}>
                          View
                        </Link>
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


