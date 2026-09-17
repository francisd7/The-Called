import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { NavLinks } from '@/components/NavLinks';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/">
            The Called
          </a>
          <NavLinks role={session.user.role} />
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/signin' });
            }}
          >
            <span className="whoami">{session.user.name} · </span>
            <button
              type="submit"
              style={{ border: 'none', background: 'none', padding: 0, minHeight: 'auto' }}
            >
              <span className="whoami">Sign out</span>
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
