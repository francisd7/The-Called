import { eq, and } from 'drizzle-orm';
import { currentUser } from '@/lib/session';
import { db } from '@/db';
import { eodReports } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { EodCharts } from '@/components/EodCharts';
import { EodReview } from '@/components/EodReview';
import { StreakStrip } from '@/components/StreakStrip';
import { saveEodReport } from '@/lib/actions';
import { getDayStats, getEodCharts, getEodWeekReview } from '@/lib/queries';
import type { Bucket } from '@/lib/eodCharts';
import { getStreaks } from '@/lib/streaks';
import { teamDateString, weekStart } from '@/lib/dates';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EodPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await currentUser();
  const userId = me!.id;
  const isAdmin = me!.role === 'admin';
  const today = teamDateString();
  const thisWeek = weekStart();

  // Anything that isn't a plain date is ignored rather than handed to Postgres,
  // which turns a mistyped link into this week instead of a 500.
  const params = await searchParams;
  const asked = params.week;
  const week =
    typeof asked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asked)
      ? weekStart(new Date(`${asked}T12:00:00Z`))
      : thisWeek;
  const bucket: Bucket = params.bucket === 'week' ? 'week' : 'day';
  // Roughly the same stretch of time either way: six weeks of days, or three
  // months of weeks.
  const bucketCount = bucket === 'day' ? 42 : 13;

  const [existing, stats, streaks, review, charts] = await Promise.all([
    db.query.eodReports.findFirst({
      where: and(eq(eodReports.userId, userId), eq(eodReports.reportDate, today)),
    }),
    getDayStats(userId),
    getStreaks(),
    isAdmin ? getEodWeekReview(week) : null,
    isAdmin ? getEodCharts(bucket, bucketCount) : null,
  ]);

  return (
    <>
      <h1>End of day — {today}</h1>
      <p className="sub">
        {existing
          ? 'Already submitted today. Saving again updates it.'
          : 'Numbers are yours to count — the dashboard only sees leads you logged here.'}
      </p>

      {/* Everyone sees everyone's - the point of a streak is that somebody else
          can see it. Nothing else about another person's EOD is shown here. */}
      <StreakStrip rows={streaks} primary="eod" />

      {/* An admin comes here to read the week, not to file one, so the review
          goes first and their own form sits underneath it. */}
      {review && (
        <>
          <EodReview
            review={review}
            thisWeek={thisWeek}
            bucketQuery={bucket === 'day' ? '' : `&bucket=${bucket}`}
            charts={
              charts && (
                <EodCharts
                  people={charts.people}
                  rows={charts.rows}
                  buckets={charts.buckets}
                  bucket={bucket}
                  extraQuery={week === thisWeek ? '' : `&week=${week}`}
                />
              )
            }
          />
          <div className="panel-divider" style={{ margin: '1.6rem 0 1rem' }} />
          <h2>Your own report</h2>
        </>
      )}

      {/* Shown as a reference, never prefilled: not every outbound DM becomes a
          lead row, so using these as the answer would understate the real day. */}
      <div className="stats">
        <div className="stat">
          <div className="stat-n">{stats.newLeads}</div>
          <div className="stat-l">leads logged today</div>
        </div>
        <div className="stat">
          <div className="stat-n">{stats.replies}</div>
          <div className="stat-l">replies logged</div>
        </div>
        <div className="stat">
          <div className="stat-n">{stats.booked}</div>
          <div className="stat-l">calls booked</div>
        </div>
      </div>

      <div className="card">
        <ActionForm action={saveEodReport} successMessage="EOD report saved">
          <input type="hidden" name="reportDate" value={today} />
          <div className="grid2">
            <div className="field">
              <label htmlFor="totalOutbounds">Outbounds sent (excl. follow-ups)</label>
              <input
                id="totalOutbounds"
                name="totalOutbounds"
                type="number"
                inputMode="numeric"
                defaultValue={existing?.totalOutbounds ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="totalFollowUps">Follow-ups sent</label>
              <input
                id="totalFollowUps"
                name="totalFollowUps"
                type="number"
                inputMode="numeric"
                defaultValue={existing?.totalFollowUps ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="totalLeadsWithReplies">Leads with 1+ replies</label>
              <input
                id="totalLeadsWithReplies"
                name="totalLeadsWithReplies"
                type="number"
                inputMode="numeric"
                defaultValue={existing?.totalLeadsWithReplies ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="youtubeVideosSent">YouTube videos sent</label>
              <input
                id="youtubeVideosSent"
                name="youtubeVideosSent"
                type="number"
                inputMode="numeric"
                defaultValue={existing?.youtubeVideosSent ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="callsPitched">Calls pitched</label>
              <input
                id="callsPitched"
                name="callsPitched"
                type="number"
                inputMode="numeric"
                defaultValue={existing?.callsPitched ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="callsBooked">Calls booked</label>
              <input
                id="callsBooked"
                name="callsBooked"
                type="number"
                inputMode="numeric"
                defaultValue={existing?.callsBooked ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="cashCollected">Cash collected</label>
              <input
                id="cashCollected"
                name="cashCollected"
                inputMode="decimal"
                defaultValue={existing?.cashCollected ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="revenueGenerated">Revenue generated</label>
              <input
                id="revenueGenerated"
                name="revenueGenerated"
                inputMode="decimal"
                defaultValue={existing?.revenueGenerated ?? ''}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="win">A solid win today</label>
            <textarea id="win" name="win" defaultValue={existing?.win ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="obstacle">Biggest obstacle today</label>
            <textarea id="obstacle" name="obstacle" defaultValue={existing?.obstacle ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="focusTomorrow">Focus for tomorrow</label>
            <textarea
              id="focusTomorrow"
              name="focusTomorrow"
              defaultValue={existing?.focusTomorrow ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="notes">Anything else</label>
            <textarea id="notes" name="notes" defaultValue={existing?.notes ?? ''} />
          </div>

          <button className="btn-primary" type="submit">
            {existing ? 'Update report' : 'Submit report'}
          </button>
        </ActionForm>
      </div>

    </>
  );
}
