import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PositionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Positions</h1>
        <p className="text-muted-foreground">Broker positions will appear here (Tradier).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          This page is not implemented yet. The backend is ready to query Tradier positions during webhook validation; next step
          is exposing them via an authenticated API and rendering them here.
        </CardContent>
      </Card>
    </div>
  );
}


