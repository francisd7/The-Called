import { redirect } from 'next/navigation';
import { asc } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { removePerson, savePerson } from '@/lib/peopleActions';

export const dynamic = 'force-dynamic';

const ROLE_HELP: Record<string, string> = {
  admin: 'Everything, including this screen.',
  setter: 'Leads, confirmations, triage, EOD.',
  closer: 'No sign-in. Gets pre-call briefs in Discord; exists so bookings attribute to them.',
};

function PersonFields({
  person,
}: {
  person?: typeof users.$inferSelect;
}) {
  return (
    <div className="grid2">
      <div className="field">
        <label htmlFor={`name-${person?.id ?? 'new'}`}>Name</label>
        <input id={`name-${person?.id ?? 'new'}`} name="name" defaultValue={person?.name ?? ''} required />
      </div>
      <div className="field">
        <label htmlFor={`email-${person?.id ?? 'new'}`}>Email</label>
        <input
          id={`email-${person?.id ?? 'new'}`}
          name="email"
          type="email"
          defaultValue={person?.email.startsWith('CHANGEME') ? '' : (person?.email ?? '')}
          placeholder={person?.email.startsWith('CHANGEME') ? 'Not set yet' : undefined}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`role-${person?.id ?? 'new'}`}>Role</label>
        <select id={`role-${person?.id ?? 'new'}`} name="role" defaultValue={person?.role ?? 'setter'}>
          <option value="setter">Setter</option>
          <option value="closer">Closer</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: 0 }}>
          <input
            type="checkbox"
            name="active"
            defaultChecked={person ? person.active : true}
            style={{ width: 'auto' }}
          />
          <span>Can sign in</span>
        </label>
      </div>
    </div>
  );
}

export default async function PeoplePage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') redirect('/');

  const people = await db.select().from(users).orderBy(asc(users.name));

  return (
    <>
      <p className="sub">
        <a href="/admin">← Admin</a>
      </p>
      <h1>People</h1>
      <p className="sub">
        Sign-in is matched on email address — a Google login for an address that isn&apos;t here,
        or isn&apos;t ticked &ldquo;can sign in&rdquo;, is refused.
      </p>

      <div className="card">
        <strong>Adding someone here doesn&apos;t notify them</strong>
        <p className="sub" style={{ margin: '0.3rem 0 0' }}>
          No email is sent — it only means their Google login will be accepted. Send them the link
          yourself.
        </p>
        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          A <strong>closer</strong> needs no sign-in, and setting one up is optional. Give them the
          address on their <em>Calendly</em> account and their bookings attach to their record;
          leave it and the call still shows their name, just not linked to anyone. Nigel&apos;s
          Calendly account is <code>nigel6.daley@gmail.com</code>.
        </p>
      </div>

      {people.map((person) => (
        <div className="card" key={person.id}>
          <div className="card-head">
            <strong>{person.name}</strong>
            <span className="card-meta">
              {person.email.startsWith('CHANGEME') ? (
                <span className={`pill ${person.active ? 'warn' : ''}`}>
                  {person.active ? 'no email set' : 'not set up'}
                </span>
              ) : (
                person.email
              )}
            </span>
          </div>
          <p className="sub" style={{ margin: '0.15rem 0 0.6rem' }}>{ROLE_HELP[person.role]}</p>

          <ActionForm action={savePerson}>
            <input type="hidden" name="id" value={person.id} />
            <PersonFields person={person} />
            <div className="card-row">
              <button className="btn-primary" type="submit">
                Save
              </button>
            </div>
          </ActionForm>

          {person.active && person.id !== session.user.id && (
            <ActionForm action={removePerson}>
              <input type="hidden" name="id" value={person.id} />
              <button type="submit">Revoke access</button>
            </ActionForm>
          )}
        </div>
      ))}

      <h2>Add someone</h2>
      <div className="card">
        <ActionForm action={savePerson}>
          <PersonFields />
          <div className="card-row">
            <button className="btn-primary" type="submit">
              Add person
            </button>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
