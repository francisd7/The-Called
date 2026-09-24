import { formatTimeOnly } from '@/lib/dates';

type Call = {
  id: string;
  igHandle: string;
  name: string | null;
  callScheduledFor: Date | null;
  confirmed: boolean;
};

/** The working day the strip covers. Anything outside clamps to an end. */
const START_HOUR = 8;
const END_HOUR = 20;

function fractionOfDay(d: Date | null): number {
  if (!d) return 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: 'America/New_York',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // 24 comes back for midnight from some ICU builds; it means hour zero.
  const hour = get('hour') % 24;
  const at = hour + get('minute') / 60;
  return Math.max(0, Math.min(1, (at - START_HOUR) / (END_HOUR - START_HOUR)));
}

/**
 * Today's calls where they actually fall, so the shape of the day reads
 * without counting cards - where the gaps are, what is back to back, and what
 * is still unconfirmed.
 *
 * The cards underneath carry the detail. This only has to answer "what does
 * today look like" from across a room.
 */
export function DayStrip({ calls }: { calls: Call[] }) {
  if (calls.length === 0) return null;

  const ordered = [...calls].sort(
    (a, b) => (a.callScheduledFor?.getTime() ?? 0) - (b.callScheduledFor?.getTime() ?? 0)
  );
  const ticks = ['8am', '11am', '2pm', '5pm', '8pm'];
  const unconfirmed = ordered.filter((c) => !c.confirmed).length;

  return (
    <div className="daystrip">
      <div className="daystrip-track">
        {ticks.map((t, i) => (
          <span key={t} className="daystrip-tick" style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}>
            {t}
          </span>
        ))}
        {ordered.map((c, i) => (
          <a
            key={c.id}
            href={`#call-${c.id}`}
            // Alternating rows: two calls within an hour of each other print
            // over each other on a single row, which is most of a working day.
            className={`daystrip-call ${c.confirmed ? 'is-confirmed' : 'is-unconfirmed'} ${
              i % 2 ? 'is-low' : ''
            }`}
            style={{ left: `${fractionOfDay(c.callScheduledFor) * 100}%` }}
            // The name is on the card this links to, a few centimetres below.
            // Printing it here as well is what made two calls in the same hour
            // collide, and the strip only has to carry the shape of the day.
            title={`${formatTimeOnly(c.callScheduledFor)} · ${c.name?.trim() || `@${c.igHandle}`}`}
          >
            <span className="daystrip-dot" />
            <span className="daystrip-label">{formatTimeOnly(c.callScheduledFor)}</span>
          </a>
        ))}
      </div>
      <p className="sub daystrip-key">
        Filled is confirmed, hollow is not.
        {unconfirmed > 0 ? ` ${unconfirmed} still to confirm.` : ' All confirmed.'}
      </p>
    </div>
  );
}
