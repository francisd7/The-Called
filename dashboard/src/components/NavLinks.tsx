'use client';

import { usePathname } from 'next/navigation';

// The six places there is work to do. Admin is not one of them - it sits with
// the account controls on the right. Below the breakpoint the short label is
// swapped in by CSS rather than letting the row scroll sideways.
const LINKS = [
  { href: '/', label: 'Dashboard', short: 'Home' },
  { href: '/leads', label: 'Leads', short: 'Leads' },
  { href: '/calls', label: 'Calls', short: 'Calls' },
  { href: '/kpis', label: 'KPIs', short: 'KPIs' },
  { href: '/eod', label: 'EOD', short: 'EOD' },
  { href: '/ads', label: 'Ads', short: 'Ads' },
];

export function NavLinks() {
  const pathname = usePathname();
  // Admin lives on the right now, beside Sign out: it is the plumbing, not the
  // work, and keeping it out of this row is what puts the row back on one line.
  const links = LINKS;

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
