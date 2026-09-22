import { BookingLinks } from '@/components/BookingLinks';
import {
  LeadBrowser,
  leadsUrl,
  FILTER_KEYS,
  one,
  pageSizeFrom,
  type Params,
} from '@/components/LeadBrowser';
import { ConvoRow } from '@/components/ConvoRow';
import { auth } from '@/auth';
import { StreakStrip } from '@/components/StreakStrip';
import {
  getActiveConvos,
  getActiveOffers,
  getFollowUpCounts,
  getLeadCardLookups,
  getOptions,
  getSetters,
  searchLeads,
} from '@/lib/queries';
import { getStreaks } from '@/lib/streaks';
import { db } from '@/db';
import { countDuplicateGroups } from '@/lib/duplicates';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Params>;



export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // The layout has already turned anyone without a session away, so this is
  // only ever read for the role and the id.
  const session = await auth();
  const isAdmin = session?.user?.role === 'admin';
  const meId = session?.user?.id ?? '';
  const page = Number.parseInt(one(params, 'page') ?? '1', 10) || 1;

  const perPage = pageSizeFrom(params);

  const [
    result,
    convos,
    setters,
    stages,
    qualities,
    sources,
    lookups,
    streaks,
    offers,
    followUps,
    duplicateCount,
  ] = await Promise.all([
    searchLeads({
      q: one(params, 'q'),
      setterId: one(params, 'setterId'),
      stage: one(params, 'stage'),
      quality: one(params, 'quality'),
      source: one(params, 'source'),
      booked: one(params, 'booked') === '1',
      activity: one(params, 'activity'),
      page,
      perPage,
    }),
    getActiveConvos(),
    getSetters(),
    getOptions('conversation_stage'),
    getOptions('lead_quality'),
    getOptions('lead_source'),
    getLeadCardLookups(),
    getStreaks(),
    getActiveOffers(),
    getFollowUpCounts(),
    countDuplicateGroups(db),
  ]);



  return (
    <>
      <h1>Lead Tracker</h1>

      <div className="stats">
        <div className="stat stat-hero">
          <div className="stat-n">{convos.teamTotal}</div>
          <div className="stat-l">team active conversations</div>
        </div>
        {convos.groups.map((g) => (
          <div className="stat" key={g.id}>
            <div className="stat-n">{g.total}</div>
            <div className="stat-l">{g.name}</div>
          </div>
        ))}
        {convos.unassigned.total > 0 && (
          <div className="stat alert">
            <div className="stat-n">{convos.unassigned.total}</div>
            <div className="stat-l">unassigned</div>
          </div>
        )}
      </div>

      <StreakStrip rows={streaks} />

      <div className="card-row" style={{ marginBottom: '0.9rem' }}>
        <a className="btn" href="/leads/follow-ups">
          Follow Ups
          <span className="pill warn">{followUps['1w']}</span>
        </a>
        {/* The same list with none of this page above it, for when the job is
            the list rather than the morning. */}
        <a className="btn" href="/leads/all?perPage=250">
          All leads
        </a>
        {/* Only when there is something to sort out - a nought beside a link
            nobody needs is just another thing to read past. */}
        {duplicateCount > 0 && (
          <a className="btn" href="/leads/duplicates">
            Possible duplicates
            <span className="pill warn">{duplicateCount}</span>
          </a>
        )}
      </div>

      <h2>Send a booking link</h2>
      <p className="sub">
        Matched back to a lead by the Instagram handle they type into the booking form — so that
        question has to stay required on all three.
      </p>
      <BookingLinks offers={offers} />

      <h2>Active conversations</h2>
      <div className="convo-board">
        {convos.groups.map((group) => (
          <section className="panel" key={group.id}>
            <div className="panel-head">
              <h3>{group.name}</h3>
              <span className="card-meta">{group.total}</span>
            </div>
            {group.leads.length === 0 ? (
              <p className="panel-empty">No active conversations.</p>
            ) : (
              <ul className="convos">
                {group.leads.map((lead) => (
                  <ConvoRow key={lead.id} lead={lead} stageLabels={lookups.stageLabels} />
                ))}
              </ul>
            )}
            {group.total > group.leads.length && (
              <a className="btn" href={leadsUrl('/leads/all', { setterId: group.id, activity: 'active', perPage: '250' })}>
                See all {group.total}
              </a>
            )}
          </section>
        ))}
      </div>

      {convos.unassigned.total > 0 && (
        <section className="panel" style={{ marginTop: '0.7rem' }}>
          <div className="panel-head">
            <h3>Unassigned</h3>
            <span className="card-meta">{convos.unassigned.total}</span>
          </div>
          <p className="sub" style={{ marginTop: 0 }}>
            Live conversations with nobody on them — mostly the imported backlog. Open one and set
            a setter, or mark it not active.
          </p>
          <ul className="convos">
            {convos.unassigned.leads.map((lead) => (
              <ConvoRow key={lead.id} lead={lead} stageLabels={lookups.stageLabels} />
            ))}
          </ul>
          {convos.unassigned.total > convos.unassigned.leads.length && (
            <a className="btn" href={leadsUrl('/leads/all', { setterId: 'none', activity: 'active', perPage: '250' })}>
              See all {convos.unassigned.total}
            </a>
          )}
        </section>
      )}

      <LeadBrowser
        heading="All leads"
        result={result}
        setters={setters}
        stages={stages}
        qualities={qualities}
        sources={sources}
        lookups={lookups}
        params={params}
        basePath="/leads"
        isAdmin={isAdmin}
        meId={meId}
      />
    </>
  );
}
