import { currentUser } from '@/lib/session';
import { ActionForm } from '@/components/ActionForm';
import { createLead } from '@/lib/actions';
import { getOptions, getSetters } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function NewLeadPage() {
  const me = await currentUser();
  const [setters, sources, openers, stages, qualities, icps] = await Promise.all([
    getSetters(),
    getOptions('lead_source'),
    getOptions('opener'),
    getOptions('conversation_stage'),
    getOptions('lead_quality'),
    getOptions('icp'),
  ]);

  return (
    <>
      <p className="sub">
        <a href="/leads">← Lead Tracker</a>
      </p>
      <h1>New lead</h1>
      <p className="sub">
        Only the handle is required. Name, email and phone arrive on their own when the lead books
        a call, so there&apos;s nothing to type here.
      </p>

      <div className="card">
        <ActionForm action={createLead} successMessage="Lead created">
          <div className="field">
            <label htmlFor="igHandle">Instagram handle *</label>
            <input id="igHandle" name="igHandle" required placeholder="@theirhandle" autoFocus />
          </div>
          <div className="grid2">
            <div className="field">
              {/* Whoever is filling this in is almost always the person who
                  will work it, and the action defaults to them anyway. It used
                  to open on a disabled "Choose…" and be marked required, so the
                  form refused to submit on the one field the page says you do
                  not have to fill in. */}
              <label htmlFor="setterId">Setter</label>
              <select id="setterId" name="setterId" defaultValue={me?.id ?? ''}>
                {setters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="conversationStage">Stage</label>
              <select id="conversationStage" name="conversationStage" defaultValue="outreached">
                {stages.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="leadSource">Source</label>
              <select id="leadSource" name="leadSource">
                <option value="">—</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="opener">Opener</label>
              <select id="opener" name="opener">
                <option value="">—</option>
                {openers.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="leadQuality">Quality</label>
              <select id="leadQuality" name="leadQuality">
                <option value="">—</option>
                {qualities.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="icp">ICP</label>
              <select id="icp" name="icp">
                <option value="">—</option>
                {icps.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="card-row">
            <button className="btn-new" type="submit">
              Create lead
            </button>
            <a className="btn" href="/leads">
              Cancel
            </a>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
