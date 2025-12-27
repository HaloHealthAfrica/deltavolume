'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const links = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/webhooks', label: 'Webhooks' },
  { href: '/admin/signals', label: 'Signals' },
  { href: '/admin/positions', label: 'Positions' },
  { href: '/admin/trades', label: 'Trades' },
];

export function AdminSubnav() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {links.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent text-muted-foreground hover:text-foreground'
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}


