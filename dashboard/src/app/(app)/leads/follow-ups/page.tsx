import { ActionForm } from '@/components/ActionForm';
import { SetterBadge } from '@/components/SetterBadge';
import { markMessageSent, markNoFollowUp } from '@/lib/assignActions';
import { relativeDays } from '@/lib/dates';
import {
  FOLLOW_UP_BUCKETS,
  getFollowUpCounts,
  getFollowUps,
  getLeadCardLookups,
  getSetters,
  type FollowUpBucket,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export default async function FollowUpsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const bucket = (one(params, 'bucket') ?? '1w') as FollowUpBucket;
  const setterId = one(params, 'setterId');

  const [rows, counts, setters, lookups] = await Promise.all([
    getFollowUps(bucket, setterId),
    getFollowUpCounts(setterId),
    getSetters(),
    getLeadCardLookups(),
  ]);

  const qs = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const k of ['bucket', 'setterId']) {
      const v = k in over ? over[k] : one(params, k);
      if (v) next.set(k, v);
    }
    return `/leads/follow-ups?${next.toString()}`;
  };

  return (
    <>
      <p className="sub">
        <a href="/leads">← Lead Tracker</a>
      </p>
      <h1>Follow Ups</h1>
      <p className="sub">
        Active conversations that have gone quiet, measured from the last time somebody actually
        reached out. Logging a message moves it straight back into live conversations.
      </p>

      {/* Buckets are cumulative on purpose - "1 month+" includes the year-old
          ones, because a list that hid the worst offenders under a longer tab
          would be the wrong way round. */}
      <div className="bucket-tabs">
        {FOLLOW_UP_BUCKETS.map((b) => (
          <a
            key={b.key}
            href={qs({ bucket: b.key })}
            className={`btn${b.key === bucket ? ' btn-primary' : ''}`}
          >
            {b.label}
            <span className="pill">{counts[b.key]}</span>
          </a>
        ))}
      </div>

      <form className="toolbar" method="get">
        <input type="hidden" name="bucket" value={bucket} />
        <div className="field">
          <label htmlFor="setterId">Whose</label>
          <select id="setterId" name="setterId" defaultValue={setterId ?? ''}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {setters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">Filter</button>
      </form>

      <p className="sub">
        {counts[bucket].toLocaleString()} in this bucket
        {counts[bucket] > rows.length && ` — showing the ${rows.length} quietest`}
      </p>

      {rows.length === 0 ? (
        <p className="empty">Nothing this quiet.</p>
      ) : (
        <div className="table-wrap">
          <table className="lead-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Silent for</th>
                <th>Setter</th>
                <th>Stage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => {
                const silent = lead.lastOutreachAt ?? lead.lastContactAt ?? lead.leadCreatedAt;
                return (
                  <tr key={lead.id}>
                    <td>
                      <a href={`/leads/${lead.id}`}>{lead.name?.trim() || `@${lead.igHandle}`}</a>
                    </td>
                    <td>{relativeDays(silent)}</td>
                    <td>
                      <SetterBadge
                        name={lead.setterId ? lookups.setterNames.get(lead.setterId) : null}
                        color={lead.setterId ? lookups.setterColors.get(lead.setterId) : null}
                      />
                    </td>
                    <td>
                      {lead.conversationStage
                        ? (lookups.stageLabels.get(lead.conversationStage) ?? lead.conversationStage)
                        : '—'}
                    </td>
                    <td>
                      <span className="row-actions">
                        <ActionForm action={markMessageSent} successMessage="Logged">
                          <input type="hidden" name="leadId" value={lead.id} />
                          <button type="submit">Messaged</button>
                        </ActionForm>
                        <ActionForm action={markNoFollowUp} successMessage="Closed out">
                          <input type="hidden" name="leadId" value={lead.id} />
                          <button type="submit">No follow up</button>
                        </ActionForm>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
