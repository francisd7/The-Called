import { ActionForm } from '@/components/ActionForm';
import { BulkAssignBar } from '@/components/BulkAssignBar';
import { FilterDialog } from '@/components/FilterDialog';
import { LeadTable } from '@/components/LeadTable';
import { bulkLeadAction } from '@/lib/assignActions';
import type { leads, optionSets, users } from '@/db/schema';

type Lead = typeof leads.$inferSelect;
type Option = typeof optionSets.$inferSelect;
type Person = typeof users.$inferSelect;

export const PAGE_SIZES = [25, 50, 100, 250, 500];
export const FILTER_KEYS = [
  'q',
  'setterId',
  'stage',
  'quality',
  'source',
  'booked',
  'activity',
] as const;

export type Params = Record<string, string | string[] | undefined>;

export function one(params: Params, key: string) {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function pageSizeFrom(params: Params) {
  const n = Number(one(params, 'perPage'));
  return PAGE_SIZES.includes(n) ? n : 50;
}

/** A lead-list URL built from scratch, for links that set their own filters. */
export function leadsUrl(basePath: string, values: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v) next.set(k, v);
  const q = next.toString();
  return q ? `${basePath}?${q}` : basePath;
}

/**
 * The searchable, filterable, selectable list of leads.
 *
 * Shared by the lead tracker and by the full-page list rather than copied into
 * both: everything here comes in pairs - a filter and the link that preserves
 * it, a page size and the form that has to carry it - and two copies of that
 * drift apart in a week.
 */
export function LeadBrowser({
  result,
  setters,
  stages,
  qualities,
  sources,
  lookups,
  params,
  basePath,
  isAdmin,
  meId,
  heading,
}: {
  result: { rows: Lead[]; total: number; page: number; pages: number };
  setters: Person[];
  stages: Option[];
  qualities: Option[];
  sources: Option[];
  lookups: {
    setterNames: Map<string, string>;
    setterColors: Map<string, string | null>;
    stageLabels: Map<string, string>;
  };
  params: Params;
  /** Where the filter form and every pager link point. */
  basePath: string;
  isAdmin: boolean;
  meId: string;
  /** Omitted on the page that is nothing but this. */
  heading?: string;
}) {
  const perPage = pageSizeFrom(params);
  const activeFilters = FILTER_KEYS.filter((k) => k !== 'q' && one(params, k)).length;

  const qs = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const key of [...FILTER_KEYS, 'page', 'perPage']) {
      const value = key in overrides ? overrides[key] : one(params, key);
      if (value) next.set(key, value);
    }
    return `${basePath}?${next.toString()}`;
  };

  return (
    <>
      {heading && <h2>{heading}</h2>}
      <p className="sub">
        {result.total.toLocaleString()} matching · page {result.page} of {Math.max(1, result.pages)}
      </p>

      <form className="toolbar" method="get" action={basePath}>
        {/* A GET form submits its own fields and nothing else, so without this
            setting Show 250 and then applying a filter quietly put you back on
            50 - which is exactly the order anybody doing a bulk job works in. */}
        <input type="hidden" name="perPage" value={String(perPage)} />
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
