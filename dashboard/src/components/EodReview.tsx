import { SetterBadge } from '@/components/SetterBadge';
import { shiftDateString } from '@/lib/dates';
import { EOD_COUNTS, EOD_MONEY } from '@/lib/eodMath';
import type { getEodWeekReview } from '@/lib/queries';

type Review = Awaited<ReturnType<typeof getEodWeekReview>>;

/** "Mon 15", from a plain YYYY-MM-DD, with no timezone to drift through. */
function dayLabel(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
}

function monthLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function money(n: number) {
  return n === 0
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * The week a setter actually had, for the one person reviewing it.
 *
 * Laid out around the people rather than the reports, so somebody who filed
 * nothing is a row of blanks instead of quietly missing from the page - which
 * is the thing worth seeing.
 */
export function EodReview({ review, thisWeek }: { review: Review; thisWeek: string }) {
  const { days, people, team, weekOf, today } = review;
  const prev = shiftDateString(weekOf, -7);
  const next = shiftDateString(weekOf, 7);
  const isThisWeek = weekOf === thisWeek;
  const missingToday = days.includes(today)
    ? people.filter((p) => !p.byDay.has(today))
    : [];

  const written = days
    .map((day) => ({
      day,
      entries: people
        .map((p) => ({ person: p, report: p.byDay.get(day) }))
        .filter((e) => e.report && (e.report.win || e.report.obstacle || e.report.focusTomorrow || e.report.notes)),
    }))
    .filter((d) => d.entries.length > 0)
    .reverse();

  return (
    <>
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0 }}>
            Week of {monthLabel(weekOf)} – {monthLabel(days[6])}
          </h2>
          <p className="sub" style={{ margin: 0 }}>
            Only you can see this section.
          </p>
        </div>
        <div className="period-tabs">
          <a className="btn" href={`/eod?week=${prev}`}>
            ← Previous
          </a>
          {!isThisWeek && (
            <a className="btn" href="/eod">
              This week
            </a>
          )}
          <a className="btn" href={`/eod?week=${next}`}>
            Next →
          </a>
        </div>
      </div>

      {isThisWeek &&
        (missingToday.length === 0 ? (
          <p className="sub">Everyone has filed today.</p>
        ) : (
          <p className="sub">
            <span className="pill warn">Not in yet today</span>{' '}
            {missingToday.map((p) => p.name).join(', ')}
          </p>
        ))}

      <h3>Filed</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Setter</th>
              {days.map((d) => (
                <th key={d} style={{ textAlign: 'center' }}>
                  {dayLabel(d)}
                </th>
              ))}
              <th style={{ textAlign: 'center' }}>Days</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>
                  <SetterBadge name={p.name} color={p.color} />
                </td>
                {days.map((d) => {
                  const filed = p.byDay.has(d);
                  // Today isn't a miss until the day is out, and a day that
                  // hasn't happened certainly isn't. Marking either in red
                  // would put a failure on the table every morning.
                  const notYet = d >= today;
                  return (
                    <td key={d} style={{ textAlign: 'center' }}>
                      {filed ? (
                        <span className="pill ok">✓</span>
                      ) : notYet ? (
                        <span className="card-meta">·</span>
                      ) : (
                        <span className="pill danger">—</span>
                      )}
                    </td>
                  );
                })}
                <td style={{ textAlign: 'center' }}>
                  <strong>{p.filed}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Totals</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Setter</th>
              {EOD_COUNTS.map((f) => (
                <th key={f.key} style={{ textAlign: 'right' }}>
                  {f.label}
                </th>
              ))}
              {EOD_MONEY.map((f) => (
                <th key={f.key} style={{ textAlign: 'right' }}>
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>
                  <SetterBadge name={p.name} color={p.color} />
                </td>
                {EOD_COUNTS.map((f) => (
                  <td key={f.key} style={{ textAlign: 'right' }}>
                    {p.totals[f.key] || '—'}
                  </td>
                ))}
                {EOD_MONEY.map((f) => (
                  <td key={f.key} style={{ textAlign: 'right' }}>
                    {money(p.totals[f.key])}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td>
                <strong>Team</strong>
              </td>
              {EOD_COUNTS.map((f) => (
                <td key={f.key} style={{ textAlign: 'right' }}>
                  <strong>{team[f.key] || '—'}</strong>
                </td>
              ))}
              {EOD_MONEY.map((f) => (
                <td key={f.key} style={{ textAlign: 'right' }}>
                  <strong>{money(team[f.key])}</strong>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h3>What they said</h3>
      {written.length === 0 ? (
        <p className="empty">Nothing written this week.</p>
      ) : (
        written.map(({ day, entries }) => (
          <div key={day} style={{ marginBottom: '0.9rem' }}>
            <p className="card-meta" style={{ marginBottom: '0.35rem' }}>
              {dayLabel(day)}
            </p>
            <div className="panel-grid">
              {entries.map(({ person, report }) => (
                <div className="panel" key={person.id}>
                  <div className="panel-head">
                    <SetterBadge name={person.name} color={person.color} />
                  </div>
                  {report!.win && (
                    <div className="note">
                      <div className="note-meta">Win</div>
                      <div className="note-body">{report!.win}</div>
                    </div>
                  )}
                  {report!.obstacle && (
                    <div className="note">
                      <div className="note-meta">Obstacle</div>
                      <div className="note-body">{report!.obstacle}</div>
                    </div>
                  )}
                  {report!.focusTomorrow && (
                    <div className="note">
                      <div className="note-meta">Focus tomorrow</div>
                      <div className="note-body">{report!.focusTomorrow}</div>
                    </div>
                  )}
                  {report!.notes && (
                    <div className="note">
                      <div className="note-meta">Anything else</div>
                      <div className="note-body">{report!.notes}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
