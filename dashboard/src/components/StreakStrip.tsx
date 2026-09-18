import { SetterBadge } from '@/components/SetterBadge';
import type { StreakRow } from '@/lib/streaks';

/**
 * The reward side of the daily habit: how many days in a row each setter has
 * touched the tracker. A streak that's alive but not yet banked today reads
 * differently from a cold one, so "keep it going" is visible before it breaks.
 */
export function StreakStrip({ rows, showEod = false }: { rows: StreakRow[]; showEod?: boolean }) {
  if (rows.length === 0) return null;

  return (
    <div className="streaks">
      {rows.map((r) => (
        <div
          className={`streak ${r.tracker.current === 0 ? 'is-cold' : r.tracker.aliveToday ? 'is-hot' : ''}`}
          key={r.userId}
        >
          <SetterBadge name={r.name} color={r.color} />
          <span>
            <span className="streak-n">{r.tracker.current}</span>
            <span className="streak-l">
              {' '}
              day{r.tracker.current === 1 ? '' : 's'} in a row on the tracker
              {!r.tracker.aliveToday && r.tracker.current > 0 && ' — not yet today'}
            </span>
          </span>
          {showEod && (
            <span style={{ borderLeft: '1px solid var(--border)', paddingLeft: '0.55rem' }}>
              <span className="streak-n">{r.eod.current}</span>
              <span className="streak-l">
                {' '}
                day{r.eod.current === 1 ? '' : 's'} in a row of EOD
                {!r.eod.aliveToday && r.eod.current > 0 && ' — not yet today'}
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
