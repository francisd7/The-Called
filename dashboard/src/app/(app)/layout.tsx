import type { ReactNode } from 'react';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { signOut } from '@/auth';
import { currentUser } from '@/lib/session';
import { stopViewingAs } from '@/lib/viewAsActions';
import { NavLinks } from '@/components/NavLinks';
import { ReportProblem } from '@/components/ReportProblem';
import { getOpenIssueCount } from '@/lib/issues';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await currentUser();
  if (!me) redirect('/signin');

  // Only an admin acts on these, so only an admin pays for the query. Read off
  // the effective role, so viewing as a setter hides the count the same way it
  // is hidden for them.
  const openIssues = me.role === 'admin' ? await getOpenIssueCount() : 0;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/">
            <Image
              src="/logo.webp"
              alt="The Called"
              width={2000}
              height={655}
              priority
              className="brand-logo"
            />
            <span className="brand-sub">Setter Dashboard</span>
          </a>
          <NavLinks role={me.role} openIssues={openIssues} />
          <div className="topbar-right">
            <ReportProblem />
            <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/signin' });
            }}
          >
              <span className="whoami">{me.name} · </span>
              <button
                type="submit"
                style={{ border: 'none', background: 'none', padding: 0, minHeight: 'auto' }}
              >
                <span className="whoami">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      {me.viewingAs && (
        <div className="viewas-bar">
          <span>
            Viewing as <strong>{me.name}</strong> — read-only. You are signed in as{' '}
            {me.viewingAs.realName}.
          </span>
          <form
            action={async () => {
              'use server';
              await stopViewingAs();
            }}
          >
            <button type="submit">Back to my view</button>
          </form>
        </div>
      )}
      <main className={me.viewingAs ? 'has-viewas' : undefined}>{children}</main>
    </>
  );
}
