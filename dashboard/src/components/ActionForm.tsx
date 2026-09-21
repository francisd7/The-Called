'use client';

import { useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

type Result = { ok: true; message?: string } | { ok: false; error: string };
type Message = { ok: boolean; text: string };

/**
 * The parts that need to know a submission is in flight.
 *
 * This has to be its own component inside the <form>: `useFormStatus` reports
 * on the nearest form above it. Tracking it with `useState` in the parent
 * doesn't work - React runs a form action inside a transition and holds those
 * updates back until the action finishes, so a "pending" flag set that way
 * never paints while it would actually be useful.
 */
function Body({ children, message }: { children: ReactNode; message: Message | null }) {
  const { pending } = useFormStatus();

  return (
    <>
      <fieldset className="action-fieldset" disabled={pending}>
        {children}
      </fieldset>

      {/* An import can run for the better part of a minute. Without this the
          page looks identical to one where the click never landed. */}
      {pending && (
        <p className="msg msg-working" role="status">
          <span className="spinner" aria-hidden="true" />
          Working… this can take a minute.
        </p>
      )}

      {/* The previous result disappears while a new run is going, so a stale
          answer can't be mistaken for the new one. */}
      {!pending && message && <p className={`msg ${message.ok ? 'ok' : 'err'}`}>{message.text}</p>}
    </>
  );
}

/**
 * Wraps a server action so the result is shown inline instead of vanishing.
 * Matters most for triage: that action can succeed at saving and still fail to
 * reach Discord, and the setter needs to know which happened.
 */
export function ActionForm({
  action,
  children,
  successMessage,
  className,
}: {
  action: (formData: FormData) => Promise<Result>;
  children: ReactNode;
  successMessage?: string;
  className?: string;
}) {
  const [message, setMessage] = useState<Message | null>(null);

  return (
    <form
      className={className}
      action={async (formData: FormData) => {
        setMessage(null);
        try {
          const result = await action(formData);
          setMessage(
            result.ok
              ? { ok: true, text: result.message ?? successMessage ?? 'Saved' }
              : { ok: false, text: result.error }
          );
        } catch {
          setMessage({ ok: false, text: 'Something went wrong — try again.' });
        }
      }}
    >
      <Body message={message}>{children}</Body>
    </form>
  );
}
