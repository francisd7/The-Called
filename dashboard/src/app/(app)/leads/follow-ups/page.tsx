import { ActionForm } from '@/components/ActionForm';
import { SetterBadge } from '@/components/SetterBadge';
import { markMessageSent, markNoFollowUp } from '@/lib/assignActions';
import { claimLead } from '@/lib/assignActions';
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
type Lead = Awaited<ReturnType<typeof getFollowUps>>[number];

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function Row({
  lead,
  lookups,
  upForGrabs,
}: {
  lead: Lead;
  lookups: Awaited<ReturnType<typeof getLeadCardLookups>>;
  upForGrabs: boolean;
}) {
  const silent = lead.lastOutreachAt ?? lead.lastContactAt ?? lead.leadCreatedAt;
  return (
    <li className="convo">
      <div className="convo-main">
        <a className="convo-handle" href={`/leads/${lead.id}`}>
          {lead.name?.trim() || `@${lead.igHandle}`}
        </a>
        <span className="convo-meta">
          <span className="pill warn">{relativeDays(silent)}</span>
          {lead.conversationStage && (
            <span className="pill">
              {lookups.stageLabels.get(lead.conversationStage) ?? lead.conversationStage}
            </span>
          )}
        </span>
      </div>
      <span className="row-actions">
        {upForGrabs && (
          <ActionForm action={claimLead} successMessage="Claimed">
            <input type="hidden" name="leadId" value={lead.id} />
            <button className="btn-primary" type="submit">
              Claim
            </button>
          </ActionForm>
        )}
        <ActionForm action={markMessageSent} successMessage="Logged">
          <input type="hidden" name="leadId" value={lead.id} />
          <button type="submit">Messaged</button>
        </ActionForm>
        <ActionForm action={markNoFollowUp} successMessage="Closed out">
          <input type="hidden" name="leadId" value={lead.id} />
          <button type="submit">No follow up</button>
        </ActionForm>
      </span>
    </li>
  );
}

export default async function FollowUpsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const bucket = (one(params, 'bucket') ?? '1w') as FollowUpBucket;

  const [setters, counts, lookups] = await Promise.all([
    getSetters(),
    getFollowUpCounts(),
    getLeadCardLookups(),
  ]);

  // A column per setter. Anything still sitting with an admin was never really
  // theirs - it's the imported backlog - so it's offered up rather than parked.
  const columns = setters.filter((s) => s.role === 'setter');
  const grabbers = setters.filter((s) => s.role !== 'setter').map((s) => s.id);

  const [perSetter, upForGrabs] = await Promise.all([
    Promise.all(columns.map((s) => getFollowUps(bucket, s.id))),
    Promise.all(grabbers.map((id) => getFollowUps(bucket, id))).then((lists) => lists.flat()),
  ]);

  const qs = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const k of ['bucket']) {
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
        reached out. Logging a message moves one straight back into live conversations.
      </p>

      {/* Bands are exclusive - "1 month" means between a month and three, not
          everything older than a month - so working one tab actually empties it. */}
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

      <div className="convo-board">
        {columns.map((setter, i) => (
          <section className="panel" key={setter.id}>
            <div className="panel-head">
              <h3>
                <SetterBadge name={setter.name} color={setter.color} />
              </h3>
              <span className="card-meta">{perSetter[i].length}</span>
            </div>
            {perSetter[i].length === 0 ? (
              <p className="panel-empty">Nothing waiting in this band.</p>
            ) : (
              <ul className="convos">
                {perSetter[i].map((lead) => (
                  <Row key={lead.id} lead={lead} lookups={lookups} upForGrabs={false} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {upForGrabs.length > 0 && (
        <section className="panel" style={{ marginTop: '0.7rem' }}>
          <div className="panel-head">
            <h3>Up for grabs</h3>
            <span className="card-meta">{upForGrabs.length}</span>
          </div>
          <p className="sub" style={{ marginTop: 0 }}>
            The imported backlog — nobody is really working these. Claim one to put it on your list.
          </p>
          <ul className="convos">
            {upForGrabs.map((lead) => (
              <Row key={lead.id} lead={lead} lookups={lookups} upForGrabs />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
