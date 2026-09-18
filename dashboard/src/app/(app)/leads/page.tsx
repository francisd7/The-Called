import { ConvoRow } from '@/components/ConvoRow';
import { FilterDialog } from '@/components/FilterDialog';
import { LeadTable } from '@/components/LeadTable';
import {
  getActiveConvos,
  getLeadCardLookups,
  getOptions,
  getSetters,
  searchLeads,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_KEYS = ['q', 'setterId', 'stage', 'quality', 'source', 'booked', 'activity'] as const;

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Number.parseInt(one(params, 'page') ?? '1', 10) || 1;

  const [result, convos, setters, stages, qualities, sources, lookups] = await Promise.all([
    searchLeads({
      q: one(params, 'q'),
      setterId: one(params, 'setterId'),
      stage: one(params, 'stage'),
      quality: one(params, 'quality'),
      source: one(params, 'source'),
      booked: one(params, 'booked') === '1',
      activity: one(params, 'activity'),
      page,
    }),
    getActiveConvos(),
    getSetters(),
    getOptions('conversation_stage'),
    getOptions('lead_quality'),
    getOptions('lead_source'),
    getLeadCardLookups(),
  ]);

  // Everything except the free-text search, which stays visible on the page.
  const activeFilters = FILTER_KEYS.filter((k) => k !== 'q' && one(params, k)).length;

  const qs = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const key of [...FILTER_KEYS, 'page']) {
      const value = key in overrides ? overrides[key] : one(params, key);
      if (value) next.set(key, value);
    }
    return `/leads?${next.toString()}`;
  };

  return (
    <>
      <h1>Lead Tracker</h1>

      <div className="stats">
        <div className="stat">
          <div className="stat-n">{convos.teamTotal}</div>
          <div className="stat-l">active conversations</div>
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

        <a className="btn" href="/leads/new">
          + New lead
        </a>
      </form>

      {result.rows.length === 0 ? (
        <p className="empty">No leads match those filters.</p>
      ) : (
        <LeadTable
          rows={result.rows}
          setterNames={lookups.setterNames}
          stageLabels={lookups.stageLabels}
        />
      )}

      {result.pages > 1 && (
        <div className="card-row" style={{ justifyContent: 'space-between' }}>
          {result.page > 1 ? (
            <a className="btn" href={qs({ page: String(result.page - 1) })}>
              ← Previous
            </a>
          ) : (
            <span />
          )}
          {result.page < result.pages && (
            <a className="btn" href={qs({ page: String(result.page + 1) })}>
              Next →
            </a>
          )}
        </div>
      )}
    </>
  );
}
