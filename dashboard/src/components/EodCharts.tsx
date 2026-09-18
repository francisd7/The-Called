import { LineChart } from '@/components/charts/LineChart';
import { buildEodSeries, type Bucket, type MetricKey } from '@/lib/eodCharts';
import type { PersonLike, ReportLike } from '@/lib/eodMath';

/**
 * Three charts rather than one with three scales. Outreach runs in the tens,
 * calls booked in single digits and cash in thousands; putting any two of them
 * on one pair of axes would invite a relationship the numbers don't support.
 */
const CHARTS: Array<{ metric: MetricKey; title: string; sub: string; money?: boolean }> = [
  {
    metric: 'totalOutbounds',
    title: 'Outbounds sent',
    sub: 'The top of the funnel, and the number everything below it depends on.',
  },
  {
    metric: 'callsBooked',
    title: 'Calls booked',
    sub: 'As reported at the end of the day, not as recorded on a lead.',
  },
  {
    metric: 'cashCollected',
    title: 'Cash collected',
    sub: 'Reported on the day it came in.',
    money: true,
  },
];

export function EodCharts({
  people,
  rows,
  buckets,
  bucket,
  extraQuery = '',
}: {
  people: PersonLike[];
  rows: ReportLike[];
  buckets: string[];
  bucket: Bucket;
  /** Whatever else is on the URL, so switching bucket doesn't lose the week. */
  extraQuery?: string;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <h3 style={{ margin: 0 }}>Over time</h3>
          <p className="sub" style={{ margin: 0 }}>
            A gap is a day nobody filed a report, drawn as a gap rather than a zero — we don&apos;t
            know what happened, and a line through the baseline would claim we do.
          </p>
        </div>
        <div className="period-tabs">
          <a className={`btn${bucket === 'day' ? ' btn-primary' : ''}`} href={`?bucket=day${extraQuery}`}>
            Daily
          </a>
          <a className={`btn${bucket === 'week' ? ' btn-primary' : ''}`} href={`?bucket=week${extraQuery}`}>
            Weekly
          </a>
        </div>
      </div>

      {CHARTS.map((c) => (
        <div key={c.metric} style={{ marginBottom: '1.2rem' }}>
          <h4 style={{ margin: '0 0 0.1rem' }}>{c.title}</h4>
          <p className="sub">{c.sub}</p>
          <LineChart
            series={buildEodSeries({ people, rows, buckets, bucket, metric: c.metric })}
            format={c.money ? 'usd' : 'number'}
            xUnit={bucket}
            tableCaption={`${c.title} per ${bucket}, by setter`}
          />
        </div>
      ))}
    </>
  );
}
