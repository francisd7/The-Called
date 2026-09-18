import { FunnelChart } from '@/components/charts/FunnelChart';
import { LineChart } from '@/components/charts/LineChart';
import { StreakStrip } from '@/components/StreakStrip';
import { getSetters } from '@/lib/queries';
import { getStreaks } from '@/lib/streaks';
import { callsBooked, defaultRange, funnel, money, outreach } from '@/lib/kpis';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const VIEWS = [
  { key: 'funnel', label: 'Funnel conversion' },
  { key: 'booked', label: 'Calls booked over time' },
  { key: 'money', label: 'Cash and revenue' },
  { key: 'outreach', label: 'Outreach volume' },
] as const;

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** A date only counts if it's a real YYYY-MM-DD; anything else falls back. */
function validDate(value: string | undefined, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : value;
}

export default async function KpisPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const fallback = defaultRange();
  // Straight off the URL, so it can be anything. An unparseable date used to
  // reach the driver and throw a 500 from deep inside the query builder.
  const range = {
    from: validDate(one(params, 'from'), fallback.from),
    to: validDate(one(params, 'to'), fallback.to),
  };
  const view = (one(params, 'view') ?? 'funnel') as (typeof VIEWS)[number]['key'];
  const setterId = one(params, 'setterId');

  const [setters, streaks, steps, booked, cash, activity] = await Promise.all([
    getSetters(),
    getStreaks(),
    view === 'funnel' ? funnel(range, setterId) : Promise.resolve(null),
    view === 'booked' ? callsBooked(range, setterId) : Promise.resolve(null),
    view === 'money' ? money(range, setterId) : Promise.resolve(null),
    view === 'outreach' ? outreach(range, setterId) : Promise.resolve(null),
  ]);

  const who = setterId ? (setters.find((s) => s.id === setterId)?.name ?? 'Someone') : 'Team';
  const current = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  return (
    <>
      <h1>KPIs</h1>
      <p className="sub">
        {current.label} · {who} · {range.from} to {range.to}
      </p>

      <h2>Consistency</h2>
      <p className="sub">
        Days in a row, right now — not affected by the date range below. Showing up is the habit
        the rest of these numbers depend on.
      </p>
      <StreakStrip rows={streaks} showEod />

      <form className="toolbar" method="get">
        <div className="field">
          <label htmlFor="view">Show</label>
          <select id="view" name="view" defaultValue={view}>
            {VIEWS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="setterId">Who</label>
          <select id="setterId" name="setterId" defaultValue={setterId ?? ''}>
            <option value="">Whole team</option>
            {setters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={range.from} />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={range.to} />
        </div>
        <button className="btn-primary" type="submit">
          Update
        </button>
      </form>

      <section className="panel">
        <div className="panel-head">
          <h3>{current.label}</h3>
        </div>

        {steps && (
          <>
            <FunnelChart steps={steps} />
            <p className="sub" style={{ marginTop: '0.7rem' }}>
              Counted by when the lead was created, so a lead that closed after the window still
              counts in the window it entered.
            </p>
          </>
        )}
        {booked && <LineChart series={booked} tableCaption="Calls booked per week by setter" />}
        {cash && (
          <LineChart series={cash} format="usd" tableCaption="Cash collected and contract value per week" />
        )}
        {activity && (
          <>
            <LineChart series={activity} tableCaption="Outreach volume per week" />
            <p className="sub" style={{ marginTop: '0.7rem' }}>
              From the numbers setters enter in EOD Reports — it only covers days they filed one.
            </p>
          </>
        )}
      </section>
    </>
  );
}
