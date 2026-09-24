import { getBookedCalls, getClosers, getSetters, type CallFilters } from '@/lib/queries';
import { summariseCalls } from '@/lib/callStats';
import { formatCallTime, teamDateString, shiftDateString } from '@/lib/dates';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const money0 = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** What happened, as one word, with the shape that says which kind of word it is. */
function Outcome({
  cancelled,
  settled,
  showed,
  closed,
  reason,
}: {
  cancelled: boolean;
  settled: boolean;
  showed: boolean | null;
  closed: boolean | null;
  reason: string | null;
}) {
  if (cancelled) {
    return (
      <span className="pill warn" title={reason ?? undefined}>
        Cancelled
      </span>
    );
  }
  if (!settled) return <span className="pill">Waiting</span>;
  if (closed) return <span className="pill ok">Closed</span>;
  if (showed === false) return <span className="pill warn">No show</span>;
  return <span className="pill">No close</span>;
}

export default async function CallsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  // Ninety days back by default: long enough to see a pattern, short enough
  // that the page is about now rather than about the whole history.
  const today = teamDateString();
  const filters: CallFilters = {
    setterId: one(sp.setterId) || undefined,
    closerId: one(sp.closerId) || undefined,
    from: one(sp.from) || shiftDateString(today, -90),
    to: one(sp.to) || today,
  };

  const [calls, setters, closers] = await Promise.all([
    getBookedCalls(filters),
    getSetters(),
    getClosers(),
  ]);
  const stats = summariseCalls(calls);

  return (
    <>
      <h1>Calls</h1>
      <p className="sub">
        Every call that has been booked, counted on the day it was due rather
        than the day it was entered.
      </p>

      <form className="toolbar" method="get" action="/calls">
        <div className="field">
          <label htmlFor="setterId">Setter</label>
          <select id="setterId" name="setterId" defaultValue={filters.setterId ?? ''}>
            <option value="">Everyone</option>
            {setters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="closerId">Closer</label>
          <select id="closerId" name="closerId" defaultValue={filters.closerId ?? ''}>
            <option value="">Either</option>
            {closers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={filters.from} />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={filters.to} />
        </div>
        <button type="submit">Update</button>
      </form>

      <div className="stats">
        <div className="stat tone-blue">
          <div className="stat-n">{stats.booked}</div>
          <div className="stat-l">booked</div>
        </div>
        <div className="stat tone-teal">
          <div className="stat-n">{stats.showed}</div>
          <div className="stat-l">showed · {pct(stats.showRate)}</div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{stats.closed}</div>
          <div className="stat-l">closed · {pct(stats.closeRate)} of shows</div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{money0(stats.cash)}</div>
          <div className="stat-l">cash collected</div>
        </div>
        <div className="stat tone-amber">
          <div className="stat-n">{stats.cancelled}</div>
          <div className="stat-l">cancelled · {pct(stats.cancelRate)}</div>
        </div>
        <div className="stat tone-violet">
          <div className="stat-n">{stats.cashPerShow === null ? '—' : money0(stats.cashPerShow)}</div>
          <div className="stat-l">per call that showed</div>
        </div>
      </div>

      <p className="sub">
        {stats.settled < stats.held ? (
          <>
            {stats.held - stats.settled} of these {stats.held} held calls{' '}
            {stats.held - stats.settled === 1 ? 'has' : 'have'} no result recorded yet, so{' '}
            {stats.held - stats.settled === 1 ? 'it counts' : 'they count'} in neither the show rate
            nor the close rate. A call nobody has written up is unknown, not a no-show.
          </>
        ) : (
          <>Every held call in this range has a result recorded.</>
        )}
      </p>

      {calls.length === 0 ? (
        <p className="empty">No calls booked in this range.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Setter</th>
                <th>Closer</th>
                <th>Offer</th>
                <th>Before the call</th>
                <th>Outcome</th>
                <th className="num">Cash</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td className="nowrap">{formatCallTime(c.callScheduledFor)}</td>
                  <td>
                    <a href={`/leads/${c.id}`}>{c.name?.trim() || `@${c.igHandle}`}</a>
                  </td>
                  <td>{c.setterName ?? '—'}</td>
                  <td>{c.closerName ?? '—'}</td>
                  <td>{c.offerLabel ?? '—'}</td>
                  <td className="nowrap">
                    {c.confirmed ? <span className="pill ok">Confirmed</span> : null}{' '}
                    {c.triaged ? <span className="pill ok">Triaged</span> : null}
                    {!c.confirmed && !c.triaged ? <span className="pill warn">Neither</span> : null}
                  </td>
                  <td>
                    <Outcome
                      cancelled={c.cancelled}
                      settled={c.settled}
                      showed={c.showed}
                      closed={c.closed}
                      reason={c.cancelReason}
                    />
                  </td>
                  <td className="num">
                    {c.cashCollected ? money0(Number(c.cashCollected)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
