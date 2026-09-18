'use client';

import { usePathname } from 'next/navigation';

// Five full labels don't fit a phone, and letting the nav scroll sideways hides
// the last one behind a gesture nobody knows is there. The short label is
// swapped in by CSS below the breakpoint instead.
const LINKS = [
  { href: '/', label: 'Dashboard', short: 'Home' },
  { href: '/leads', label: 'Lead Tracker', short: 'Leads' },
  { href: '/kpis', label: 'KPIs', short: 'KPIs' },
  { href: '/eod', label: 'EOD Reports', short: 'EOD' },
];

export function NavLinks({ role }: { role?: string }) {
  const pathname = usePathname();
  const links =
    role === 'admin' ? [...LINKS, { href: '/admin', label: 'Admin', short: 'Admin' }] : LINKS;

  return (
    <nav className="nav">
      {links.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
        return (
          <a key={link.href} href={link.href} aria-current={active ? 'page' : undefined}>
            <span className="nav-long">{link.label}</span>
            <span className="nav-short">{link.short}</span>
          </a>
        );
      })}
    </nav>
  );
}
