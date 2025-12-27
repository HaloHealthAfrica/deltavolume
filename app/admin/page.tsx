import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActivityFeed } from '@/components/admin/activity-feed';
import { AdminSubnav } from '@/components/admin/admin-subnav';
import { OpenPositionsTable } from '@/components/admin/open-positions-table';
import { getAdminSummary, listActivity, listOpenPositions, kvConfigured } from '@/lib/admin/kv-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function AdminDashboardPage() {
  const kvOk = kvConfigured();
  if (!kvOk) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
          <p className="text-muted-foreground">Monitoring & analysis</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>KV not configured</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            Connect Vercel KV to enable admin monitoring.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [summary, positions, activity] = await Promise.all([
    getAdminSummary(),
    listOpenPositions(25),
    listActivity(50),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground">Monitoring & analysis (KV-backed)</p>
      </div>

      <AdminSubnav />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Webhooks received (today)" value={String(summary.today.webhooks)} />
        <StatCard
          label="Webhooks traded (today)"
          value={String(summary.today.decisions.EXECUTE)}
          sub={
            summary.today.webhooks > 0
              ? `${Math.round((summary.today.decisions.EXECUTE / summary.today.webhooks) * 100)}% execute rate`
              : undefined
          }
        />
        <StatCard
          label="Decisions (today)"
          value={String(summary.today.decisions.EXECUTE + summary.today.decisions.PAPER + summary.today.decisions.SKIP)}
          sub={`EXEC ${summary.today.decisions.EXECUTE} • PAPER ${summary.today.decisions.PAPER} • SKIP ${summary.today.decisions.SKIP}`}
        />
        <StatCard label="Open positions" value={String(summary.today.openPositions)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <OpenPositionsTable positions={positions} />
        <ActivityFeed initialEvents={activity as any} />
      </div>
    </div>
  );
}


