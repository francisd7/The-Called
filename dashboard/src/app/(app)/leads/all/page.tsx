import { currentUser } from '@/lib/session';
import { LeadBrowser, pageSizeFrom, one, type Params } from '@/components/LeadBrowser';
import {
  getLeadCardLookups,
  getOptions,
  getSetters,
  searchLeads,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Params>;

/**
 * Nothing but the list.
 *
 * The lead tracker opens with the numbers, the streaks, the booking links and
 * everybody's live conversations, which is right for a morning but wrong for a
 * job: handing 400 leads out, or marking a run of them live, means scrolling
 * past all of it every time the page reloads - and it reloads after every
 * press. This is the same list with none of that above it.
 */
export default async function AllLeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const me = await currentUser();
  const isAdmin = me?.role === 'admin';
  const meId = me?.id ?? '';

  const page = Number.parseInt(one(params, 'page') ?? '1', 10) || 1;

  const [result, setters, stages, qualities, sources, lookups] = await Promise.all([
    searchLeads({
      q: one(params, 'q'),
      setterId: one(params, 'setterId'),
      stage: one(params, 'stage'),
      quality: one(params, 'quality'),
      source: one(params, 'source'),
      booked: one(params, 'booked') === '1',
      activity: one(params, 'activity'),
      page,
      perPage: pageSizeFrom(params),
    }),
    getSetters(),
    getOptions('conversation_stage'),
    getOptions('lead_quality'),
    getOptions('lead_source'),
    getLeadCardLookups(),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>All leads</h1>
          <p className="sub">
            The whole list, with nothing above it. Filter it, tick what you want and hand it over
            in one press.
          </p>
        </div>
        <a className="btn" href="/leads">
          Back to the tracker
        </a>
      </div>

      <LeadBrowser
        result={result}
        setters={setters}
        stages={stages}
        qualities={qualities}
        sources={sources}
        lookups={lookups}
        params={params}
        basePath="/leads/all"
        isAdmin={isAdmin}
        meId={meId}
      />
    </>
  );
}
