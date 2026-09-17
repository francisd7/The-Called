import { ActionForm } from '@/components/ActionForm';
import { createLead } from '@/lib/actions';
import { getOptions, getSetters } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function NewLeadPage() {
  const [setters, sources, openers, stages] = await Promise.all([
    getSetters(),
    getOptions('lead_source'),
    getOptions('opener'),
    getOptions('conversation_stage'),
  ]);

  return (
    <>
      <h1>New lead</h1>
      <p className="sub">Everything except the handle can be filled in later.</p>

      <div className="card">
        <ActionForm action={createLead} successMessage="Lead created">
          <div className="field">
            <label htmlFor="igHandle">Instagram handle *</label>
            <input id="igHandle" name="igHandle" required placeholder="@theirhandle" />
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" type="tel" />
            </div>
            <div className="field">
              <label htmlFor="setterId">Setter</label>
              <select id="setterId" name="setterId">
                <option value="">Me</option>
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
          </div>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="checkbox" name="outboundDm" style={{ width: 'auto' }} />
            <span>Outbound DM sent</span>
          </label>
          <div className="card-row">
            <button className="btn-primary" type="submit">
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
