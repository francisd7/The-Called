import { SetterBadge } from '@/components/SetterBadge';
import type { StreakRow } from '@/lib/streaks';

type Which = 'tracker' | 'eod';

const LABELS: Record<Which, string> = {
  tracker: 'in a row on the tracker',
  eod: 'in a row of EOD',
};

function Part({ streak, which }: { streak: { current: number; aliveToday: boolean }; which: Which }) {
  return (
    <span>
      <span className="streak-n">{streak.current}</span>
      <span className="streak-l">
        {' '}
        day{streak.current === 1 ? '' : 's'} {LABELS[which]}
        {!streak.aliveToday && streak.current > 0 && ' — not yet today'}
      </span>
    </span>
  );
}

/**
 * The reward side of the daily habit: how many days in a row each setter has
 * kept something up. A streak that's alive but not yet banked today reads
 * differently from a cold one, so "keep it going" is visible before it breaks.
 *
 * Which streak leads depends on the page it's on - the EOD page is about
 * filing, the tracker is about touching leads - and the leading one is what
 * sets the colour.
 */
export function StreakStrip({
  rows,
  primary = 'tracker',
  secondary,
}: {
  rows: StreakRow[];
  primary?: Which;
  secondary?: Which;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="streaks">
      {rows.map((r) => {
        const lead = primary === 'eod' ? r.eod : r.tracker;
        return (
          <div
            className={`streak ${lead.current === 0 ? 'is-cold' : lead.aliveToday ? 'is-hot' : ''}`}
            key={r.userId}
          >
            <SetterBadge name={r.name} color={r.color} />
            <Part streak={lead} which={primary} />
            {secondary && (
              <span className="streak-second">
                <Part streak={secondary === 'eod' ? r.eod : r.tracker} which={secondary} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
