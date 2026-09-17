import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';

type SearchParams = Promise<{ error?: string }>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  if (session?.user?.id) redirect('/');

  const { error } = await searchParams;

  return (
    <main>
      <div className="signin">
        <h1>The Called</h1>
        <p className="sub">Setter dashboard</p>

        {error === 'AccessDenied' && (
          <div className="card" style={{ textAlign: 'left' }}>
            <strong>That Google account isn&apos;t on the list.</strong>
            <p className="sub" style={{ marginTop: '0.4rem' }}>
              Access is granted per email address, so signing in with a different Google account
              than the one you were added under will land here. Check which account your browser
              used — if you&apos;re signed into more than one, Google may have picked the wrong one.
            </p>
            <p className="sub">Ask Francis to add the address you actually want to use.</p>
          </div>
        )}

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <button className="btn-primary" type="submit" style={{ width: '100%' }}>
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
