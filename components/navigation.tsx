// components/navigation.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { 
  LayoutDashboard, 
  Radio, 
  Briefcase, 
  TrendingUp, 
  Settings,
  Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';

const routes = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: '/',
  },
  {
    label: 'Signals',
    icon: Radio,
    href: '/signals',
  },
  {
    label: 'Positions',
    icon: Briefcase,
    href: '/positions',
  },
  {
    label: 'Performance',
    icon: TrendingUp,
    href: '/performance',
  },
  {
    label: 'Settings',
    icon: Settings,
    href: '/settings',
  },
  {
    label: 'Admin',
    icon: Shield,
    href: '/admin',
  },
];

export function Navigation() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <nav className="border-b bg-card">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-2xl">⚡</span>
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                TradeBot
              </span>
            </Link>
            
            <div className="hidden md:flex items-center gap-1">
              {routes.map((route) => (
                <Link
                  key={route.href}
                  href={route.href}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                    pathname === route.href
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  <route.icon className="h-4 w-4" />
                  {route.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
              <span className="text-sm text-muted-foreground">Live</span>
            </div>

            {session?.user ? (
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-accent transition-colors"
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/login"
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-accent transition-colors"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
