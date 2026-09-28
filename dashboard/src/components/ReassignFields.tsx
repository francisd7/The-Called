"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

type Option = { value: string; label: string };

/**
 * Fires once each time a submission finishes.
 *
 * React resets the form's DOM when a server action resolves. Text inputs it
 * puts back, but a <select> it leaves reset while its own state still says
 * otherwise - so no re-render is scheduled and the box keeps showing the
 * wrong option. Remounting the fields is what puts them back in step.
 */
function OnSettled({ run }: { run: () => void }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) run();
    wasPending.current = pending;
  }, [pending, run]);

  return null;
}

/**
 * The fields for "Move a pile of leads by date", holding their own values.
 *
 * A form with a server action resets its uncontrolled inputs once the action
 * resolves, which is right nearly everywhere and wrong here: the result line
 * stays on screen while the dropdown above it snaps back to its default, so
 * the numbers end up sitting under a pile they were not about. Somebody
 * reading "248 leads move" next to a box reading "Unassigned" has to guess
 * which one is lying. Keeping the values means the answer stays attached to
 * the question, and Move them can follow a dry run without retyping anything.
 */
export function ReassignFields({
  sources,
  destinations,
}: {
  sources: Option[];
  destinations: Option[];
}) {
  const [from, setFrom] = useState("unassigned");
  const [to, setTo] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");

  // Bumped after every submission, to remount the fields from the state above
  // rather than leave them showing what React's form reset left behind.
  const [syncKey, setSyncKey] = useState(0);
  const resync = useCallback(() => setSyncKey((k) => k + 1), []);

  return (
    <>
      <OnSettled run={resync} />
      <div className="grid2" key={syncKey}>
        <div className="field">
          <label htmlFor="fromSetterId">Whose leads</label>
          <select
            id="fromSetterId"
            name="fromSetterId"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {sources.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="toSetterId">Middle band goes to</label>
          <select
            id="toSetterId"
            name="toSetterId"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Pick somebody</option>
            {destinations.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="first">First date</label>
          <input
            id="first"
            name="first"
            type="date"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="last">Second date</label>
          <input
            id="last"
            name="last"
            type="date"
            value={last}
            onChange={(e) => setLast(e.target.value)}
          />
        </div>

        <div className="field field-wide">
          <div className="btn-row">
            <button type="submit" name="dryRun" value="1">
              Dry run
            </button>
            <button
              className="btn-danger"
              type="submit"
              name="dryRun"
              value="0"
            >
              Move them
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
