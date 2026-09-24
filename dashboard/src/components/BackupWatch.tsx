'use client';

import { useEffect, useState, useTransition } from 'react';
import { backupIfDue } from '@/lib/backupActions';

/**
 * Sets the weekly backup going when somebody opens the dashboard.
 *
 * The same trick the post-call sync uses, for the same reason: there is no
 * scheduler on this service, and the one thing a backup must not depend on is
 * a person remembering. Somebody opens this page most days, so a weekly copy
 * needs nothing from anybody.
 *
 * Renders nothing and reports nothing. A setter opening the dashboard should
 * not see a message about a file going to the COO chat, and if it fails it is
 * recorded as a problem on Admin instead.
 */
export function BackupWatch({ due }: { due: boolean }) {
  const [started, setStarted] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    if (started || !due) return;
    setStarted(true);
    start(async () => {
      await backupIfDue();
    });
  }, [started, due]);

  return null;
}
