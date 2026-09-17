import { auth } from '@/auth';

export default async function HomePage() {
  const session = await auth();

  return (
    <main>
      <h1>The Called — Setter Dashboard</h1>
      {session?.user ? (
        <p>
          Signed in as {session.user.name} ({session.user.role}).
        </p>
      ) : (
        <p>
          <a href="/api/auth/signin">Sign in with Google</a>
        </p>
      )}
      <p style={{ color: 'var(--muted)' }}>
        Scaffold only — lead queue, confirmations and triage land once the schema is signed off.
      </p>
    </main>
  );
}
