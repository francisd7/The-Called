'use client';

import { useState } from 'react';

export function CopyButton({ value, label = 'Copy link' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Clipboard access is blocked outside a secure context and on some
          // mobile browsers; selecting the text by hand still works.
          window.prompt('Copy this link:', value);
          return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
