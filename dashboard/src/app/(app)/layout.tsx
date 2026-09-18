import type { ReactNode } from 'react';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { NavLinks } from '@/components/NavLinks';
import { ReportProblem } from '@/components/ReportProblem';
import { getOpenIssueCount } from '@/lib/issues';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  // Only an admin acts on these, so only an admin pays for the query.
  const openIssues = session.user.role === 'admin' ? await getOpenIssueCount() : 0;

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
          <NavLinks role={session.user.role} openIssues={openIssues} />
          <div className="topbar-right">
            <ReportProblem />
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
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
