import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PerformanceChart } from '@/components/performance-chart';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PerformancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Performance</h1>
        <p className="text-muted-foreground">Performance analytics and trade outcomes.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <PerformanceChart />
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            Once Tradier execution + post-trade tracking is enabled, this page will show win rate, expectancy, and P&amp;L over time.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


