'use client';

import { useState, type ReactNode } from 'react';

type Result = { ok: true; message?: string } | { ok: false; error: string };

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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className={className}
      action={async (formData: FormData) => {
        setPending(true);
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
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {children}
      </fieldset>
      {/* An import can take the better part of a minute. Without this the page
          looks identical to one where the click never registered. */}
      {pending && (
        <p className="msg msg-working" role="status">
          <span className="spinner" aria-hidden="true" />
          Working…
        </p>
      )}
      {!pending && message && <p className={`msg ${message.ok ? 'ok' : 'err'}`}>{message.text}</p>}
    </form>
  );
}
