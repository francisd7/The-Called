import { BookingLinks } from '@/components/BookingLinks';
import { StreakStrip } from '@/components/StreakStrip';
import { one, type Params } from '@/components/LeadBrowser';
import {
  getActiveConvos,
  getActiveOffers,
  getFollowUpCounts,
  getLeadTotals,
  getSetters,
} from '@/lib/queries';
import { getStreaks } from '@/lib/streaks';
import { db } from '@/db';
import { countDuplicateGroups } from '@/lib/duplicates';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Params>;

/** A count big enough to read across the room, and the page it opens. */
function Tile({
  n,
  label,
  href,
  tone = '',
}: {
  n: number;
  label: string;
  href: string;
  tone?: string;
}) {
  return (
    <a className={`tile ${tone}`} href={href}>
      <span className="tile-n">{n}</span>
      <span className="tile-l">{label}</span>
    </a>
  );
}

/**
 * The morning page.
 *
 * It used to print every setter's live conversations in full, capped at 25
 * each, and then the whole lead table underneath - so the thing you came to
 * look at was four screens down, and every press reloaded the lot. Now it
 * carries counts that open the page they stand for, and nothing else.
 */
export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  await searchParams;

  const setters = await getSetters();
  const workers = setters.filter((s) => s.role === 'setter');

  const [convos, streaks, offers, duplicateCount, totals, followUpsBySetter, teamFollowUps] =
    await Promise.all([
      getActiveConvos(),
      getStreaks(),
      getActiveOffers(),
      countDuplicateGroups(db),
      getLeadTotals(),
      Promise.all(workers.map((s) => getFollowUpCounts(s.id))),
      getFollowUpCounts(),
    ]);

  // The bands are exclusive, so a tile that means "how many are waiting on you"
  // has to add them up rather than show one of them.
  const sumBands = (b: Record<string, number>) => Object.values(b).reduce((a, n) => a + n, 0);
  const teamDue = sumBands(teamFollowUps);

  return (
    <>
      <h1>Lead Tracker</h1>

      <div className="stats">
        <div className="stat stat-hero tone-teal">
          <div className="stat-n">{convos.teamTotal}</div>
          <div className="stat-l">team active conversations</div>
        </div>
        {convos.unassigned.total > 0 && (
          <div className="stat alert">
            <div className="stat-n">{convos.unassigned.total}</div>
            <div className="stat-l">unassigned</div>
          </div>
        )}
      </div>

      <StreakStrip rows={streaks} />

      <div className="card-row" style={{ marginBottom: '0.9rem' }}>
        <a className="btn" href="/leads/follow-ups">
          Follow Ups
          <span className="pill warn">{teamDue}</span>
        </a>
        {/* Only when there is something to sort out - a nought beside a link
            nobody needs is just another thing to read past. */}
        {duplicateCount > 0 && (
          <a className="btn" href="/leads/duplicates">
            Possible duplicates
            <span className="pill warn">{duplicateCount}</span>
          </a>
        )}
      </div>

      <h2>Send a booking link</h2>
      <p className="sub">
        Matched back to a lead by the Instagram handle they type into the booking form — so that
        question has to stay required on all three.
      </p>
      <BookingLinks offers={offers} />

      <h2>Active conversations</h2>
      <p className="sub">
        What each of you is working right now. Open one to see the conversations and log a message.
      </p>
      {/* Both rows walk the same list of people in the same order. The active
          counts come from a query that sorts by when somebody joined and the
          follow-ups from one that sorts by name, so reading each row's own
          order put the two setters in opposite places on one screen. */}
      <div className="tile-row">
        {workers.map((s) => (
          <Tile
            key={s.id}
            n={convos.groups.find((g) => g.id === s.id)?.total ?? 0}
            label={s.name}
            href={`/leads/active?setterId=${s.id}`}
            tone="tone-teal"
          />
        ))}
        {convos.unassigned.total > 0 && (
          <Tile
            n={convos.unassigned.total}
            label="Unassigned"
            href="/leads/active?setterId=none"
            tone="tone-warn"
          />
        )}
      </div>

      <h2>Follow ups</h2>
      <p className="sub">
        Live conversations that have gone quiet for a week or more, counted from the last time
        somebody actually reached out.
      </p>
      <div className="tile-row">
        {workers.map((s, i) => (
          <Tile
            key={s.id}
            n={sumBands(followUpsBySetter[i])}
            label={s.name}
            href={`/leads/follow-ups?setterId=${s.id}`}
            tone="tone-violet"
          />
        ))}
      </div>

      <h2>All leads</h2>
      <p className="sub">
        Everyone the team has ever talked to, live or not. The list itself is a page of its own so
        this one stays short.
      </p>
      <div className="stats">
        <div className="stat tone-blue">
          <div className="stat-n">{totals.total.toLocaleString()}</div>
          <div className="stat-l">leads</div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{totals.booked}</div>
          <div className="stat-l">live bookings</div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{totals.closed}</div>
          <div className="stat-l">closed</div>
        </div>
        <div className={`stat${totals.unassigned > 0 ? ' alert' : ''}`}>
          <div className="stat-n">{totals.unassigned}</div>
          <div className="stat-l">unassigned</div>
        </div>
      </div>
      <div className="card-row">
        <a className="btn btn-primary" href="/leads/all?perPage=250">
          Open the full list
        </a>
        <a className="btn btn-new" href="/leads/new">
          + New lead
        </a>
      </div>
    </>
  );
}
