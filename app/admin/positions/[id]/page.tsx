import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminSubnav } from '@/components/admin/admin-subnav';
import { getPosition, kvConfigured } from '@/lib/admin/kv-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminPositionDetailPage(context: { params: Promise<{ id: string }> }) {
  const kvOk = kvConfigured();
  const { id } = await context.params;

  if (!kvOk) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin • Position</h1>
        <AdminSubnav />
        <Card>
          <CardHeader>
            <CardTitle>KV not configured</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">Connect Vercel KV to view position detail.</CardContent>
        </Card>
      </div>
    );
  }

  const pos = await getPosition(id);
  if (!pos) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin • Position</h1>
        <AdminSubnav />
        <Card>
          <CardHeader>
            <CardTitle>Not found</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">No position with id {id}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin • Position</h1>
        <p className="text-muted-foreground font-mono">{id}</p>
      </div>

      <AdminSubnav />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Symbol:</span> <span className="font-mono font-semibold">{pos.symbol}</span></div>
          <div><span className="text-muted-foreground">Direction:</span> {pos.direction}</div>
          <div><span className="text-muted-foreground">Status:</span> {pos.status}</div>
          <div><span className="text-muted-foreground">Quantity:</span> {pos.quantity}</div>
          <div><span className="text-muted-foreground">Entry price:</span> {pos.entryPrice}</div>
          <div><span className="text-muted-foreground">Stop:</span> {pos.stopLoss ?? '—'}</div>
          <div><span className="text-muted-foreground">Target:</span> {pos.target1 ?? '—'}</div>
          <div><span className="text-muted-foreground">Opened at:</span> {pos.openedAt}</div>
          <div><span className="text-muted-foreground">Closed at:</span> {pos.closedAt ?? '—'}</div>
          <div><span className="text-muted-foreground">Exit reason:</span> {pos.exitReason ?? '—'}</div>
          <div><span className="text-muted-foreground">Notes:</span> {pos.notes ?? '—'}</div>
        </CardContent>
      </Card>
    </div>
  );
}


