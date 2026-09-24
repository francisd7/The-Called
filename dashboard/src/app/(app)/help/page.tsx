import type { ReactNode } from 'react';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The manual, in the place the team already is.
 *
 * It lived in a shared document, which meant a second tool to open, an account
 * not everybody has, and a copy that goes stale the moment anything changes.
 * Here it ships with the thing it describes.
 */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="help-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const SETTER_SECTIONS = [
  ['getting-in', 'Getting in'],
  ['mornings', 'Start here every morning'],
  ['leads', 'Working your leads'],
  ['booked', 'When a call gets booked'],
  ['after', 'After the call'],
  ['calls', 'Every call, and how they went'],
  ['eod', 'End of day — every day'],
  ['clean', 'Keeping it clean'],
  ['short', 'The short version'],
] as const;

export default async function HelpPage() {
  const me = await currentUser();
  const isAdmin = me?.role === 'admin';

  return (
    <>
      <h1>Help</h1>
      <p className="sub" style={{ maxWidth: '44rem' }}>
        How this dashboard works, and what you are expected to do in it. It
        replaces the Airtable lead tracker and the Airtable EOD form —
        everything lives here now.
      </p>

      <nav className="help-toc" aria-label="Contents">
        {SETTER_SECTIONS.map(([id, title]) => (
          <a key={id} href={`#${id}`}>
            {title}
          </a>
        ))}
        {isAdmin && <a href="#running">Running it</a>}
      </nav>

      <Section id="getting-in" title="Getting in">
        <p>
          Sign in with <strong>the Google account on your work email</strong> — the same address
          Francis set up for you. It is an allowlist, so any other Google account gets turned away
          even if the password is right.
        </p>
        <p>
          If it will not let you in, do not keep trying. Message Francis — it is a one-line fix on
          his side.
        </p>
        <p>It works on your phone. Same link, same sign-in.</p>
      </Section>

      <Section id="mornings" title="Start here every morning">
        <p>
          Open <strong>Dashboard</strong> and work down the page. It is in the order things need
          doing, and a section disappears when there is nothing in it — so a short page means you
          are on top of it.
        </p>
        <ol>
          <li>
            <strong>Calls today</strong> — anything happening today. Confirm and triage these
            first.
          </li>
          <li>
            <strong>Next 7 days</strong> — the week ahead, so nothing sneaks up.
          </li>
          <li>
            <strong>Post-call reports to link</strong> — a report the dashboard could not place by
            itself. Most place themselves, so anything here needs you.
          </li>
          <li>
            <strong>Waiting on an outcome</strong> — calls that have been and gone with no result
            recorded. These hold up the whole funnel.
          </li>
        </ol>
        <p>
          Below that: <strong>This week</strong> for your focus and tasks, and{' '}
          <strong>Going quiet</strong> for live conversations nobody has touched in over a week.
        </p>
        <p>
          The <strong>Today / This week / This month</strong> buttons at the top only change the
          first row of numbers. The <strong>Right now</strong> row is always live.
        </p>
      </Section>

      <Section id="leads" title="Working your leads">
        <p>
          <strong>Lead Tracker</strong> is the hub. Your tile under{' '}
          <strong>Active conversations</strong> opens everything you are working right now.
        </p>

        <h3>Mark a conversation live</h3>
        <p>
          A lead only shows in your list if it is marked live. Open the lead and press{' '}
          <strong>This one is live</strong>. To do a batch at once: <strong>All leads</strong> →
          filter to yourself → tick them → <strong>Mark live</strong>.
        </p>
        <p>
          When a conversation is genuinely over, press <strong>Mark it finished</strong>. It comes
          off your list without deleting anything.
        </p>

        <h3>Press Sent when you message someone</h3>
        <p>
          On your conversations list, each row has a <strong>Sent</strong> button. Press it when you
          actually reach out. That is what the follow-up timers read — nothing else moves them, so a
          conversation you worked but did not log will nag you a week later.
        </p>

        <h3>Taking a lead</h3>
        <p>
          Every lead that was not already claimed sits with <strong>Francis</strong>. That is
          deliberate — it is a pile to pull from, not his work.
        </p>
        <p>
          When one of those conversations comes back to life, take it: open the lead and set{' '}
          <strong>Setter</strong> to yourself, or tick a batch on <strong>All leads</strong> and
          press <strong>Take these</strong>.
        </p>
        <p>
          You cannot take a lead someone else is working. If you tick a batch that includes one of
          theirs, it is left alone and the message tells you how many.
        </p>

        <h3>Starting a new conversation</h3>
        <p>
          <strong>+ New lead</strong> on the Lead Tracker. Only the handle is required — it defaults
          to you as the setter, and a lead you create starts live.
        </p>
      </Section>

      <Section id="booked" title="When a call gets booked">
        <p>
          A booking posts to Discord on its own and appears on the Dashboard, with a link straight
          to the lead. Two things have to happen before the call.
        </p>

        <h3>1. Confirm it</h3>
        <p>
          Reach out, then open the lead and press <strong>Confirmed in DMs</strong> or{' '}
          <strong>Confirmed by phone</strong>. Unconfirmed calls are the ones that no-show.
        </p>

        <h3>2. Triage it</h3>
        <p>
          Write the brief and press <strong>Mark triaged &amp; post to Discord</strong>. That post
          is how Nigel and Andrew get it — they do not open the dashboard. No triage means someone
          walks into the call cold.
        </p>
        <p>
          Answer the four questions on the form: what they actually want, what they have tried,
          their budget situation, and anything the closer should not step on.
        </p>

        <h3>If Discord says &ldquo;Nobody is on this one&rdquo;</h3>
        <p>
          Someone booked who was never in the tracker. The lead gets created automatically, but it
          has no owner and maybe no handle.
        </p>
        <p>
          Whoever sees it first: open it, set yourself as the setter, put the real Instagram handle
          in, then confirm and triage as normal. Do not leave it — nobody is watching it until
          someone claims it.
        </p>
      </Section>

      <Section id="after" title="After the call">
        <p>
          You never type an outcome in. Nigel and Andrew fill the post-call form in Airtable, the
          dashboard pulls it across on its own, and most reports land on the right lead without
          anyone doing anything.
        </p>
        <p>
          Two things are left for you, both on <strong>Dashboard</strong>. Whoever booked the call
          owns both of them for it.
        </p>
        <p>
          <strong>Post-call reports to link.</strong> A report the dashboard could not place by
          itself — usually two calls the same day with the same first name, or a name that does not
          match how the lead is saved. Search the handle and pick the person. The outcome, the cash
          and the booking all land on that lead.
        </p>
        <p>
          <strong>Waiting on an outcome.</strong> A call that has been and gone with no report
          against it. That means the form has not been filled — chase the closer in Discord. Until
          it is, the funnel and the cash are short.
        </p>
      </Section>

      <Section id="calls" title="Every call, and how they went">
        <p>
          <strong>Calls</strong> is the record of every call that has ever been booked — who it was
          with, who set it, who closed it, what happened and what came in. Filter by setter, closer
          or dates.
        </p>
        <p>
          The figures above the list are worked out from whatever is in it, so they change with the
          filters. Two of them are worth reading carefully. The <strong>show rate</strong> only
          counts calls somebody has recorded a result for — a call still waiting on its write-up is
          unknown, not a no-show, and the line under the figures says how many of those there are.
          The <strong>close rate</strong> is of the people who turned up, not of everything booked,
          so a week of cancellations does not get counted against you twice.
        </p>
        <p>
          Calls are counted on the day they were due, not the day anybody typed them in.
        </p>
      </Section>

      <Section id="eod" title="End of day — every day">
        <p>
          <strong>EOD Reports</strong>, fill it in, submit. Every day you work.
        </p>
        <p>
          The numbers are yours to count — the dashboard only sees leads you logged, so it cannot
          fill them in for you.
        </p>

        <h3>If you miss a day, go back and do it</h3>
        <p>
          Do not skip it because the day has passed. Change the date on the form and file it late.
          The number matters more than the timing, and getting in the habit of never leaving a gap
          is the whole point.
        </p>

        <h3>The streak</h3>
        <p>
          Both of your streaks show at the top of the EOD page and on the Lead Tracker — you can
          each see the other&apos;s. It counts days in a row, and yesterday still counts as alive so
          you are not punished first thing in the morning.
        </p>
      </Section>

      <Section id="clean" title="Keeping it clean">
        <h3>Do not open a second row for someone</h3>
        <p>
          Search first. If they are already in there, work the row that exists. Two rows for one
          person splits the conversation in half and neither half tells the truth.
        </p>
        <p>
          If you spot a pair, the <strong>Possible duplicates</strong> badge on the Lead Tracker is
          where they get merged — leave that to Francis, merging cannot be undone.
        </p>

        <h3>A lead with no Instagram handle</h3>
        <p>
          Some leads come from a booking where nobody typed a handle. The lead page says so at the
          top. If you know who they are, put the real handle in — without it the call cannot be tied
          back to a conversation.
        </p>

        <h3>When something looks wrong</h3>
        <p>
          <strong>Report a problem</strong> — top right, on every page. It goes straight to Francis
          with the page you were on. Use it rather than sitting on something odd.
        </p>
      </Section>

      <Section id="short" title="The short version">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Every day</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Work the Dashboard top to bottom</td>
                <td>It is in the order things need doing</td>
              </tr>
              <tr>
                <td>
                  Press <strong>Sent</strong> when you message someone
                </td>
                <td>It is what the follow-up timers read</td>
              </tr>
              <tr>
                <td>Confirm and triage before a call</td>
                <td>Unconfirmed calls no-show; untriaged calls go in cold</td>
              </tr>
              <tr>
                <td>File your EOD</td>
                <td>Even if you are filling in a day you missed</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Only an admin can do any of this, and a setter reading it would just
          be told about buttons they cannot see. */}
      {isAdmin && (
        <Section id="running" title="Running it">
          <h3>Backups</h3>
          <p>
            Every seven days the dashboard posts a full copy of every table to the COO chat on
            Discord, the first time anybody opens it after that. Nobody has to remember, and the copy
            is not on the same disk as the database.
          </p>
          <p>
            <strong>Admin → Setup &amp; imports → Backups</strong> shows when the last one went
            and has <strong>Back up now</strong>. Take one before anything big — an import, a run
            of merges.
          </p>
          <p>
            <strong>Put a backup back</strong> reads those files straight in. It fills gaps and
            never overwrites, so an old file cannot undo newer work. Overwrite is a separate tick
            for the case where the database is actually empty. Dry run first.
          </p>

          <h3>Merging duplicates</h3>
          <p>
            The <strong>Possible duplicates</strong> badge on the Lead Tracker. Each pair sits side
            by side and the page says what merging brings across. A merge cannot be undone, so back
            up first.
          </p>

          <h3>Seeing what a setter sees</h3>
          <p>
            <strong>Admin → People → View as</strong>. It swaps the whole app to their identity —
            their leads, their numbers, their menu — so a problem someone reports can be looked at
            rather than reconstructed. Read-only while it is on, and the bar at the bottom of the
            screen gets you back.
          </p>

          <h3>Imports</h3>
          <p>
            <strong>Admin → Setup</strong>. The Airtable tracker import fills gaps and never
            overwrites what Calendly or a post-call report has already established. The EOD import
            pulls the old Airtable form across. Both have a dry run.
          </p>

          <h3>Boosted reels</h3>
          <p>
            <strong>Data</strong> holds one tile per boosted reel with what it cost and what came
            back. Everything is typed in — spend and views come from Ads Manager and Instagram, and
            the calls and closes only exist here. Cost per lead and the rest are worked out, so
            there is nothing to keep in step by hand.
          </p>
        </Section>
      )}
    </>
  );
}
