'use client';

import { useState } from 'react';
import { linkTail } from '@/lib/reelMetrics';

/**
 * A link and a button that puts it on the clipboard.
 *
 * The setter is mid-conversation in Instagram when they need this, so it has
 * to be one click and it has to say plainly that it worked - a button that
 * silently does nothing leaves the paste going out empty.
 *
 * What is shown is the end of the link rather than the whole thing. A reel
 * tile is a couple of hundred pixels wide, and the start of a URL is the part
 * every link shares: "https://thecalled.c" told nobody which resource they
 * were about to send, where "hooks-guide" does. The full link is on the anchor
 * and in its tooltip.
 *
 * `navigator.clipboard` needs a secure context. The deployed dashboard is
 * HTTPS, so in practice it is there; when it is not, the label says so and the
 * link beside it can still be copied from the right-click menu.
 */
export function CopyBox({ url, label }: { url: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="copybox">
      <a className="copybox-url" href={url} target="_blank" rel="noreferrer" title={url}>
        {linkTail(url)}
      </a>
      <button type="button" className="copybox-btn" onClick={copy} aria-label={`Copy ${label}`}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy by hand' : 'Copy'}
      </button>
    </div>
  );
}
