import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminSubnav } from '@/components/admin/admin-subnav';
import { getDecision, getPosition, getWebhook, kvConfigured } from '@/lib/admin/kv-admin';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminWebhookDetailPage(context: { params: Promise<{ id: string }> }) {
  const kvOk = kvConfigured();
  const { id } = await context.params;

  if (!kvOk) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin • Webhook</h1>
        <AdminSubnav />
        <Card>
          <CardHeader>
            <CardTitle>KV not configured</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">Connect Vercel KV to view webhook detail.</CardContent>
        </Card>
      </div>
    );
  }

  const webhook = await getWebhook(id);
  if (!webhook) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin • Webhook</h1>
        <AdminSubnav />
        <Card>
          <CardHeader>
            <CardTitle>Not found</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">No webhook with id {id}</CardContent>
        </Card>
      </div>
    );
  }

  const [decisionId, positionId] = await Promise.all([
    kv.get<string>(`admin:webhooks:${id}:decision_id`),
    kv.get<string>(`admin:webhooks:${id}:position_id`),
  ]);

  const [decision, position] = await Promise.all([
    decisionId ? getDecision(String(decisionId)) : Promise.resolve(null),
    positionId ? getPosition(String(positionId)) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin • Webhook</h1>
        <p className="text-muted-foreground font-mono">{id}</p>
      </div>

      <AdminSubnav />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Ticker:</span> <span className="font-mono font-semibold">{webhook.ticker}</span></div>
            <div><span className="text-muted-foreground">Direction:</span> {webhook.direction}</div>
            <div><span className="text-muted-foreground">Source:</span> {webhook.source}</div>
            <div><span className="text-muted-foreground">Quality:</span> {webhook.quality}</div>
            <div><span className="text-muted-foreground">Confluence:</span> {webhook.confluenceScore ?? '—'}</div>
            <div><span className="text-muted-foreground">Processed:</span> {webhook.processed ? 'true' : 'false'}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {decision ? (
              <div className="space-y-2">
                <div><span className="text-muted-foreground">Action:</span> <span className="font-semibold">{decision.action}</span></div>
                <div><span className="text-muted-foreground">Instrument:</span> {decision.instrument}</div>
                <div><span className="text-muted-foreground">Confidence:</span> {decision.finalConfidence ?? '—'}</div>
                <div className="text-muted-foreground">Reason:</div>
                <div className="whitespace-pre-wrap">{decision.reason}</div>
              </div>
            ) : (
              <p className="text-muted-foreground">No decision linked.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raw Payload</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[520px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
            {JSON.stringify(webhook.rawPayload, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Position</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {position ? (
            <div className="space-y-2">
              <div><span className="text-muted-foreground">Symbol:</span> <span className="font-mono font-semibold">{position.symbol}</span></div>
              <div><span className="text-muted-foreground">Status:</span> {position.status}</div>
              <div><span className="text-muted-foreground">Qty:</span> {position.quantity}</div>
              <div><span className="text-muted-foreground">Entry:</span> {position.entryPrice}</div>
            </div>
          ) : (
            <p className="text-muted-foreground">No position linked.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


