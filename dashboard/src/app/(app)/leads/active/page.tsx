import { notFound } from 'next/navigation';
import { ConvoRow } from '@/components/ConvoRow';
import { getLeadCardLookups, getSetters, searchLeads } from '@/lib/queries';
import { one, type Params } from '@/components/LeadBrowser';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Params>;

/**
 * One person's live conversations, in full.
 *
 * The lead tracker used to print everybody's list on the front page, capped at
 * 25 each and still long enough to bury everything under it. The counts stay
 * there as tiles; the conversations live here, where there is room for all of
 * them and for the controls that go with working one.
 */
export default async function ActiveConvosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const setterId = one(params, 'setterId');

  const setters = await getSetters();
  const who =
    setterId && setterId !== 'none' ? setters.find((s) => s.id === setterId) : null;
  // A link with a setter that doesn't exist is a typo, not an empty list.
  if (setterId && setterId !== 'none' && !who) notFound();

  const [result, lookups] = await Promise.all([
    searchLeads({ setterId, activity: 'active', perPage: 500, page: 1 }),
    getLeadCardLookups(),
  ]);

  const title = who ? `${who.name}'s conversations` : setterId === 'none' ? 'Unassigned conversations' : 'Active conversations';

  return (
    <>
      <p className="sub">
        <a href="/leads">← Lead Tracker</a>
      </p>
      <h1>{title}</h1>
      <p className="sub">
        {result.total === 1 ? '1 live conversation' : `${result.total} live conversations`}. Press
        Sent when you message someone — that is what the follow-up timers read. The × marks one
        finished and takes it off this list.
      </p>

      {result.rows.length === 0 ? (
        <p className="empty">
          Nothing live here yet. Open a lead and press “This one is live” to put it on this list.
        </p>
      ) : (
        <section className="panel">
          <ul className="convos">
            {result.rows.map((lead) => (
              <ConvoRow key={lead.id} lead={lead} stageLabels={lookups.stageLabels} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
