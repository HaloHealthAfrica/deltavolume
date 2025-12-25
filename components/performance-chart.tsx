// components/performance-chart.tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart } from 'lucide-react';

export function PerformanceChart() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LineChart className="h-5 w-5" />
          Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] flex items-center justify-center text-muted-foreground">
          Chart coming soon
        </div>
      </CardContent>
    </Card>
  );
}
