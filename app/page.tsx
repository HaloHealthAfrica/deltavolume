// app/page.tsx
import { StatsCards } from '@/components/stats-cards';
import { RecentSignals } from '@/components/recent-signals';
import { PerformanceChart } from '@/components/performance-chart';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome to your automated trading system
        </p>
      </div>

      <StatsCards />
      
      <div className="grid gap-6 md:grid-cols-2">
        <RecentSignals />
        <PerformanceChart />
      </div>
    </div>
  );
}
