// components/stats-cards.tsx
import { kv } from '@vercel/kv';
import { TrendingUp, CheckCircle, Briefcase, DollarSign } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';

export async function StatsCards() {
  // Fetch metrics from KV
  const totalSignals = await kv.get<number>('metrics:total_signals') || 0;
  const executed = await kv.get<number>('metrics:signals_executed') || 0;
  const rejected = await kv.get<number>('metrics:signals_rejected') || 0;
  
  // Get today's signals
  const signalIds = await kv.lrange('signals:list', 0, -1);
  const today = new Date().toDateString();
  const todaySignals = await Promise.all(
    signalIds.map(async (id) => {
      const signal = await kv.get(id as string);
      return signal;
    })
  ).then(signals => 
    signals.filter((s: any) => 
      s && new Date(s.timestamp).toDateString() === today
    )
  );
  
  const todayExecuted = todaySignals.filter((s: any) => s.decision === 'executed').length;
  
  const stats = [
    {
      title: "Today's Signals",
      value: todaySignals.length,
      change: `${todayExecuted} executed`,
      icon: TrendingUp,
      color: 'text-success',
    },
    {
      title: 'Executed',
      value: todayExecuted,
      change: `${Math.round((todayExecuted / (todaySignals.length || 1)) * 100)}% rate`,
      icon: CheckCircle,
      color: 'text-primary',
    },
    {
      title: 'Open Positions',
      value: 0, // Will be replaced with actual count
      change: '$0',
      icon: Briefcase,
      color: 'text-warning',
    },
    {
      title: 'Total P&L',
      value: formatCurrency(0),
      change: '--',
      icon: DollarSign,
      color: 'text-purple-400',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.title}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </p>
                  <h3 className="text-2xl font-bold mt-2">
                    {stat.value}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stat.change}
                  </p>
                </div>
                <div className={`rounded-lg p-3 bg-secondary ${stat.color}`}>
                  <Icon className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
