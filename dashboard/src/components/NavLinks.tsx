'use client';

import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Today' },
  { href: '/leads', label: 'Leads' },
  { href: '/eod', label: 'EOD' },
];

export function NavLinks({ role }: { role?: string }) {
  const pathname = usePathname();
  const links = role === 'admin' ? [...LINKS, { href: '/admin', label: 'Admin' }] : LINKS;

  return (
    <nav className="nav">
      {links.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
        return (
          <a key={link.href} href={link.href} aria-current={active ? 'page' : undefined}>
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
