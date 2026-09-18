/**
 * EOD reports, turned into chart series.
 *
 * The important decision here is what to do with a day nobody filed: it becomes
 * null, not zero. A setter who didn't file might have had their best day of the
 * month, and a chart that draws them at the baseline states otherwise.
 *
 * Free of database imports, so the shape can be tested directly.
 */
import { shiftDateString, teamDateString, weekStart } from './dates.ts';
import type { CountKey, MoneyKey, PersonLike, ReportLike } from './eodMath.ts';
import { EOD_COUNTS, EOD_MONEY } from './eodMath.ts';

export type Bucket = 'day' | 'week';
export type MetricKey = CountKey | MoneyKey;

export const EOD_METRICS = [...EOD_COUNTS, ...EOD_MONEY] as ReadonlyArray<{
  key: MetricKey;
  label: string;
}>;

const MONEY_KEYS = new Set<string>(EOD_MONEY.map((m) => m.key));
export const isMoney = (key: MetricKey) => MONEY_KEYS.has(key);

/** The x-axis: the last `count` days or Mondays, oldest first, ending today. */
export function eodBuckets(bucket: Bucket, count: number, today = teamDateString()): string[] {
  if (bucket === 'day') {
    return Array.from({ length: count }, (_, i) => shiftDateString(today, -(count - 1 - i)));
  }
  const thisMonday = weekStart(new Date(`${today}T12:00:00Z`));
  return Array.from({ length: count }, (_, i) => shiftDateString(thisMonday, -7 * (count - 1 - i)));
}

/** Which bucket a report falls in. */
function bucketOf(reportDate: string, bucket: Bucket): string {
  return bucket === 'day' ? reportDate : weekStart(new Date(`${reportDate}T12:00:00Z`));
}

export function buildEodSeries<P extends PersonLike, R extends ReportLike>({
  people,
  rows,
  buckets,
  bucket,
  metric,
}: {
  people: P[];
  rows: R[];
  buckets: string[];
  bucket: Bucket;
  metric: MetricKey;
}) {
  return people.map((person) => {
    // Every report this person filed, filed under the bucket it belongs to.
    const filed = new Map<string, number>();
    for (const r of rows) {
      if (r.userId !== person.id) continue;
      const key = bucketOf(r.reportDate, bucket);
      // Money arrives from Postgres as a numeric string.
      const value = Number(r[metric] ?? 0);
      filed.set(key, (filed.get(key) ?? 0) + (Number.isFinite(value) ? value : 0));
    }

    return {
      key: person.id,
      label: person.name,
      points: buckets.map((b) => ({ x: b, y: filed.has(b) ? (filed.get(b) as number) : null })),
    };
  });
}
