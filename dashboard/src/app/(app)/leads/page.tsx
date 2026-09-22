import { BookingLinks } from '@/components/BookingLinks';
import { ConvoRow } from '@/components/ConvoRow';
import { FilterDialog } from '@/components/FilterDialog';
import { LeadTable } from '@/components/LeadTable';
import { ActionForm } from '@/components/ActionForm';
import { BulkAssignBar } from '@/components/BulkAssignBar';
import { auth } from '@/auth';
import { bulkLeadAction } from '@/lib/assignActions';
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

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_KEYS = ['q', 'setterId', 'stage', 'quality', 'source', 'booked', 'activity'] as const;
const PAGE_SIZES = [25, 50, 100, 250, 500];

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // The layout has already turned anyone without a session away, so this is
  // only ever read for the role and the id.
  const session = await auth();
  const isAdmin = session?.user?.role === 'admin';
  const meId = session?.user?.id ?? '';
  const page = Number.parseInt(one(params, 'page') ?? '1', 10) || 1;

  const perPage = PAGE_SIZES.includes(Number(one(params, 'perPage')))
    ? Number(one(params, 'perPage'))
    : 50;

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

  // Everything except the free-text search, which stays visible on the page.
  const activeFilters = FILTER_KEYS.filter((k) => k !== 'q' && one(params, k)).length;

  const qs = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const key of [...FILTER_KEYS, 'page', 'perPage']) {
      const value = key in overrides ? overrides[key] : one(params, key);
      if (value) next.set(key, value);
    }
    return `/leads?${next.toString()}`;
  };

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
              <a className="btn" href={qs({ setterId: group.id, activity: 'active', page: undefined })}>
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
            <a className="btn" href={qs({ setterId: 'none', activity: 'active', page: undefined })}>
              See all {convos.unassigned.total}
            </a>
          )}
        </section>
      )}

      <h2>All leads</h2>
      <p className="sub">
        {result.total.toLocaleString()} matching · page {result.page} of {Math.max(1, result.pages)}
      </p>

      <form className="toolbar" method="get">
        <a className="btn btn-new" href="/leads/new">
          + New lead
        </a>
        <div className="field" style={{ flex: '2 1 14rem' }}>
          <input
            name="q"
            defaultValue={one(params, 'q') ?? ''}
            placeholder="Search handle, name or email"
            aria-label="Search"
          />
        </div>
        <button className="btn-primary" type="submit">
          Search
        </button>

        <FilterDialog activeCount={activeFilters}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="activity">Conversation</label>
              <select id="activity" name="activity" defaultValue={one(params, 'activity') ?? ''}>
                <option value="">Any</option>
                <option value="active">Active only</option>
                <option value="inactive">Not active</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="setterId">Setter</label>
              <select id="setterId" name="setterId" defaultValue={one(params, 'setterId') ?? ''}>
                <option value="">Anyone</option>
                <option value="none">Unassigned</option>
                {setters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="stage">Stage</label>
              <select id="stage" name="stage" defaultValue={one(params, 'stage') ?? ''}>
                <option value="">Any</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="quality">Quality</label>
              <select id="quality" name="quality" defaultValue={one(params, 'quality') ?? ''}>
                <option value="">Any</option>
                {qualities.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="source">Source</label>
              <select id="source" name="source" defaultValue={one(params, 'source') ?? ''}>
                <option value="">Any</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="booked">Call booked</label>
              <select id="booked" name="booked" defaultValue={one(params, 'booked') ?? ''}>
                <option value="">Any</option>
                <option value="1">Booked only</option>
              </select>
            </div>
          </div>
          <div className="card-row">
            <button className="btn-primary" type="submit">
              Apply
            </button>
            <a className="btn" href="/leads">
              Clear all
            </a>
          </div>
        </FilterDialog>

      </form>

      {result.rows.length === 0 ? (
        <p className="empty">No leads match those filters.</p>
      ) : (
        /* Filter to Unassigned, tick the lot, hand them over. 432 of the rows
           the tracker brought across name nobody, so doing this a lead at a
           time is an afternoon's clicking - which means it doesn't happen. */
        <ActionForm action={bulkLeadAction}>
          <BulkAssignBar
            setters={setters}
            canAssignOthers={isAdmin}
            meId={meId}
            total={result.rows.length}
          />
          <LeadTable
            rows={result.rows}
            setterNames={lookups.setterNames}
            setterColors={lookups.setterColors}
            stageLabels={lookups.stageLabels}
            selectable
          />
        </ActionForm>
      )}

      <div className="pager">
        <span className="pager-size">
          Show
          {PAGE_SIZES.map((n) => (
            <a
              key={n}
              href={qs({ perPage: String(n), page: undefined })}
              className={`btn${n === perPage ? ' btn-primary' : ''}`}
            >
              {n}
            </a>
          ))}
        </span>

        {result.pages > 1 && (
          <span className="pager-pages">
            {result.page > 1 && (
              <a className="btn" href={qs({ page: String(result.page - 1) })}>
                ←
              </a>
            )}
            {/* A window around the current page rather than every page - at 500
                leads a page that's 22 numbers wide, and at 25 it's 22 rows. */}
            {Array.from({ length: result.pages }, (_, i) => i + 1)
              .filter(
                (n) =>
                  n === 1 ||
                  n === result.pages ||
                  Math.abs(n - result.page) <= 2
              )
              .map((n, i, arr) => (
                <span key={n}>
                  {i > 0 && arr[i - 1] !== n - 1 && <span className="pager-gap">…</span>}
                  <a
                    href={qs({ page: String(n) })}
                    className={`btn${n === result.page ? ' btn-primary' : ''}`}
                  >
                    {n}
                  </a>
                </span>
              ))}
            {result.page < result.pages && (
              <a className="btn" href={qs({ page: String(result.page + 1) })}>
                →
              </a>
            )}
          </span>
        )}
      </div>
    </>
  );
}
