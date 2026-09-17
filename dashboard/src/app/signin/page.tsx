import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';

export default async function SignInPage() {
  const session = await auth();
  if (session?.user?.id) redirect('/');

  return (
    <main>
      <div className="signin">
        <h1>The Called</h1>
        <p className="sub">Setter dashboard</p>
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
        <p className="sub" style={{ marginTop: '1rem' }}>
          Access is by invitation — ask Francis if your account isn&apos;t recognised.
        </p>
      </div>
    </main>
  );
}
