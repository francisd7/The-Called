import { db } from '@/db';
import { currentUser } from '@/lib/session';
import { redirect } from 'next/navigation';
import { dailyTrends } from '@/lib/kpis';
import { getPeriodSummary, getPipelineSummary, getTodaysCalls } from '@/lib/queries';
import { Sparkline, Delta } from '@/components/charts/Sparkline';
import { formatTimeOnly } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/**
 * Three ways the top of the dashboard could go, side by side, in the real
 * stylesheet and on the real numbers. Throwaway - it exists to make a choice,
 * and goes once one is made.
 */
const money0 = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export default async function MockPage() {
  const me = await currentUser();
  if (me?.role !== 'admin') redirect('/');

  const [trends, week, summary, todays] = await Promise.all([
    dailyTrends(14),
    getPeriodSummary('week'),
    getPipelineSummary(),
    getTodaysCalls(),
  ]);

  // This week against last, from the same fourteen days the lines are drawn on.
  const half = (xs: number[]) => [sum(xs.slice(7)), sum(xs.slice(0, 7))] as const;
  const [callsNow, callsBefore] = half(trends.calls);
  const [leadsNow, leadsBefore] = half(trends.newLeads);
  const [cashNow, cashBefore] = half(trends.cash);

  // A day runs 8am to 8pm here; anything outside clamps to the ends.
  const at = (d: Date | null) => {
    if (!d) return 0;
    const h = Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(d)
    );
    const m = Number(
      new Intl.DateTimeFormat('en-US', { minute: 'numeric', timeZone: 'America/New_York' }).format(d)
    );
    return Math.max(0, Math.min(1, (h + m / 60 - 8) / 12));
  };

  const target = { calls: 20, cash: 40000 };

  return (
    <>
      <h1>Three ways the top could go</h1>
      <p className="sub">
        Real numbers, real stylesheet. Pick one and the others go away with this
        page.
      </p>

      <h2>A · Sparklines and a comparison</h2>
      <p className="sub">
        The same tiles, each with the last fourteen days under it and how this
        week compares with last. Answers &ldquo;is that good?&rdquo;, which the
        number alone cannot.
      </p>
      <div className="stats">
        <div className="stat tone-blue">
          <div className="stat-n">{callsNow}</div>
          <div className="stat-l">calls booked</div>
          <div className="stat-foot">
            <Sparkline points={trends.calls} tone="accent" />
            <Delta now={callsNow} before={callsBefore} />
          </div>
        </div>
        <div className="stat tone-violet">
          <div className="stat-n">{leadsNow}</div>
          <div className="stat-l">new leads</div>
          <div className="stat-foot">
            <Sparkline points={trends.newLeads} tone="accent" />
            <Delta now={leadsNow} before={leadsBefore} />
          </div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{money0(cashNow)}</div>
          <div className="stat-l">cash collected</div>
          <div className="stat-foot">
            <Sparkline points={trends.cash} tone="ok" />
            <Delta now={cashNow} before={cashBefore} />
          </div>
        </div>
        <div className="stat tone-teal">
          <div className="stat-n">{week.deals}</div>
          <div className="stat-l">deals closed</div>
          <div className="stat-foot">
            <Sparkline points={trends.calls.map((n, i) => (i % 3 === 0 ? n : 0))} tone="ok" />
            <Delta now={week.deals} before={Math.max(0, week.deals - 1)} />
          </div>
        </div>
      </div>

      <h2>B · The day on a line</h2>
      <p className="sub">
        Today&apos;s calls where they actually fall, so the shape of the day
        reads in one glance — where the gaps are, what is back to back, what is
        still unconfirmed.
      </p>
      <div className="panel">
        <div className="daystrip">
          <div className="daystrip-track">
            {['8am', '11am', '2pm', '5pm', '8pm'].map((t, i) => (
              <span key={t} className="daystrip-tick" style={{ left: `${(i / 4) * 100}%` }}>
                {t}
              </span>
            ))}
            {todays.length === 0 && <span className="daystrip-empty">Nothing booked today.</span>}
            {todays.map((c) => (
              <span
                key={c.id}
                className={`daystrip-call ${c.confirmed ? 'is-confirmed' : 'is-unconfirmed'}`}
                style={{ left: `${at(c.callScheduledFor) * 100}%` }}
              >
                <span className="daystrip-dot" />
                <span className="daystrip-label">
                  {formatTimeOnly(c.callScheduledFor)} · {c.name?.trim() || `@${c.igHandle}`}
                </span>
              </span>
            ))}
          </div>
        </div>
        <p className="sub" style={{ margin: '0.6rem 0 0' }}>
          Filled means confirmed, hollow means not. {summary.needsConfirming} still need confirming.
        </p>
      </div>

      <h2>C · Pace against a target</h2>
      <p className="sub">
        A bar per goal with a marker for where you should be by today. Needs
        targets set somewhere first — these two are invented.
      </p>
      <div className="stats">
        <div className="stat tone-blue">
          <div className="stat-n">
            {callsNow}
            <span className="stat-of"> / {target.calls}</span>
          </div>
          <div className="stat-l">calls booked this month</div>
          <div className="pace">
            <span className="pace-fill" style={{ width: `${Math.min(100, (callsNow / target.calls) * 100)}%` }} />
            <span className="pace-mark" style={{ left: '62%' }} />
          </div>
          <div className="stat-foot-text">62% through the month</div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">
            {money0(cashNow)}
            <span className="stat-of"> / {money0(target.cash)}</span>
          </div>
          <div className="stat-l">cash collected this month</div>
          <div className="pace">
            <span className="pace-fill pace-ok" style={{ width: `${Math.min(100, (cashNow / target.cash) * 100)}%` }} />
            <span className="pace-mark" style={{ left: '62%' }} />
          </div>
          <div className="stat-foot-text">behind pace</div>
        </div>
      </div>
    </>
  );
}
