import { LeadCard } from '@/components/LeadCard';
import { getLeadCardLookups, getOptions, getSetters, searchLeads } from '@/lib/queries';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Number.parseInt(one(params, 'page') ?? '1', 10) || 1;

  const [result, setters, stages, lookups] = await Promise.all([
    searchLeads({
      q: one(params, 'q'),
      setterId: one(params, 'setterId'),
      stage: one(params, 'stage'),
      booked: one(params, 'booked') === '1',
      page,
    }),
    getSetters(),
    getOptions('conversation_stage'),
    getLeadCardLookups(),
  ]);

  const qs = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const key of ['q', 'setterId', 'stage', 'booked', 'page']) {
      const value = key in overrides ? overrides[key] : one(params, key);
      if (value) next.set(key, value);
    }
    return `/leads?${next.toString()}`;
  };

  return (
    <>
      <h1>Leads</h1>
      <p className="sub">
        {result.total.toLocaleString()} total · page {result.page} of {Math.max(1, result.pages)}
      </p>

      <form className="toolbar" method="get">
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={one(params, 'q') ?? ''} placeholder="Handle, name or email" />
        </div>
        <div className="field">
          <label htmlFor="setterId">Setter</label>
          <select id="setterId" name="setterId" defaultValue={one(params, 'setterId') ?? ''}>
            <option value="">Anyone</option>
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
        <button className="btn-primary" type="submit">
          Filter
        </button>
        <a className="btn" href="/leads/new">
          + New lead
        </a>
      </form>

      {result.rows.length === 0 ? (
        <p className="empty">No leads match those filters.</p>
      ) : (
        result.rows.map((lead) => <LeadCard key={lead.id} lead={lead} showDate {...lookups} />)
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
