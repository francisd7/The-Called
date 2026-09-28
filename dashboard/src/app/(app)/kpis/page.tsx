import { FunnelChart } from "@/components/charts/FunnelChart";
import { LineChart } from "@/components/charts/LineChart";
import { StreakStrip } from "@/components/StreakStrip";
import { getSetters } from "@/lib/queries";
import { getStreaks } from "@/lib/streaks";
import {
  callsBooked,
  defaultRange,
  funnel,
  money,
  outreach,
  totals,
} from "@/lib/kpis";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** A date only counts if it's a real YYYY-MM-DD; anything else falls back. */
function validDate(value: string | undefined, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : value;
}

export default async function KpisPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const fallback = defaultRange();
  // Straight off the URL, so it can be anything. An unparseable date used to
  // reach the driver and throw a 500 from deep inside the query builder.
  const range = {
    from: validDate(one(params, "from"), fallback.from),
    to: validDate(one(params, "to"), fallback.to),
  };
  const setterId = one(params, "setterId");

  // All four, always. Picking one at a time meant four page loads to answer a
  // question about one week, and no way to see a dip in bookings next to the
  // outreach that did or didn't cause it.
  const [setters, streaks, steps, booked, cash, activity, sums] =
    await Promise.all([
      getSetters(),
      getStreaks(),
      funnel(range, setterId),
      callsBooked(range, setterId),
      money(range, setterId),
      outreach(range, setterId),
      totals(range, setterId),
    ]);

  const money0 = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

  const who = setterId
    ? (setters.find((s) => s.id === setterId)?.name ?? "Someone")
    : "Team";

  return (
    <>
      <h1>KPIs</h1>
      <p className="sub">
        {who} · {range.from} to {range.to}
      </p>

      <h2>Consistency</h2>
      <p className="sub">
        Days in a row, right now — not affected by the date range below. Showing
        up is the habit the rest of these numbers depend on.
      </p>
      <StreakStrip rows={streaks} secondary="eod" />

      <form className="toolbar" method="get">
        <div className="field">
          <label htmlFor="setterId">Who</label>
          <select id="setterId" name="setterId" defaultValue={setterId ?? ""}>
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

      {/* Size before shape. The charts answer "which way is it going"; these
          answer "how much", which is the number that gets quoted. */}
      <p className="stats-label">{who} · this period</p>
      <div className="stats">
        <div className="stat tone-green">
          <div className="stat-n">{money0(sums.cash)}</div>
          <div className="stat-l">cash collected</div>
          <div className="stat-foot-text">
            {sums.cashPerClose === null
              ? "no closes yet"
              : `${money0(sums.cashPerClose)} a close`}
          </div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{money0(sums.contract)}</div>
          <div className="stat-l">revenue generated</div>
        </div>
        <div className="stat tone-teal">
          <div className="stat-n">{sums.closed}</div>
          <div className="stat-l">deals closed</div>
        </div>
        <div className="stat tone-blue">
          <div className="stat-n">{sums.booked}</div>
          <div className="stat-l">calls booked</div>
        </div>
        <div className="stat tone-blue">
          <div className="stat-n">{sums.newLeads}</div>
          <div className="stat-l">new leads</div>
        </div>
      </div>
      <p className="sub" style={{ marginTop: "-0.3rem" }}>
        Cash, revenue and closes count on the day the deal closed; calls on the
        day they were booked; leads on the day they came in. Three different
        dates, so they are counted separately rather than forced onto one.
      </p>

      <section className="panel">
        <div className="panel-head">
          <h3>Funnel conversion</h3>
        </div>
        <FunnelChart steps={steps} />
        <p className="sub" style={{ marginTop: "0.7rem" }}>
          Counted by when the lead was created, so a lead that closed after the
          window still counts in the window it entered.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Calls booked over time</h3>
        </div>
        <LineChart
          series={booked}
          tableCaption="Calls booked per week by setter"
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Cash and revenue</h3>
        </div>
        <LineChart
          series={cash}
          format="usd"
          tableCaption="Cash collected and contract value per week"
        />
        <p className="sub" style={{ marginTop: "0.7rem" }}>
          Counted by the day the call closed, not the day somebody typed it up.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Outreach volume</h3>
        </div>
        <LineChart series={activity} tableCaption="Outreach volume per week" />
        <p className="sub" style={{ marginTop: "0.7rem" }}>
          From the numbers setters enter in EOD Reports — it only covers days
          they filed one.
        </p>
      </section>
    </>
  );
}
