import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SettingsPage() {
  const kvConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const webhookSecretConfigured = Boolean(process.env.WEBHOOK_SECRET);
  const autoTrading = String(process.env.ENABLE_AUTO_TRADING ?? 'false').toLowerCase() === 'true';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Deployment and integration status.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Storage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="font-medium">KV configured:</span> {kvConfigured ? 'Yes' : 'No'}
            </div>
            <div className="text-muted-foreground">
              Signals are stored in KV under `signals:list` and `signals:*` records.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trading</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="font-medium">Webhook secret:</span> {webhookSecretConfigured ? 'Set' : 'Not set'}
            </div>
            <div>
              <span className="font-medium">Auto trading:</span> {autoTrading ? 'Enabled' : 'Disabled'}
            </div>
            <div className="text-muted-foreground">
              Recommended: keep auto trading disabled until Tradier credentials are verified in sandbox.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


