import { CATEGORIES } from '@gib/shared';
import { repo } from './db.ts';
import { query } from './catalog.ts';

/**
 * Push the best pickup deal per category via ntfy (https://ntfy.sh).
 * Install the ntfy app on Android, subscribe to the topic shown in Settings.
 */
export async function sendMorningDigest(): Promise<{ sent: boolean; body: string; reason?: string }> {
  const profile = repo.profile();
  const lines: string[] = [];
  for (const c of CATEGORIES) {
    const top = query({ category: c.id, mode: 'pickup', maxMiles: profile.radiusMiles, limit: 1 })[0];
    if (!top) continue;
    const ft = top.usesFirstTime ? ' (first-timer)' : '';
    lines.push(`${c.label}: $${top.perUnit.toFixed(2)}${top.unitLabel} · ${top.product.name} @ ${top.store.name}${ft}`);
  }
  const body = lines.join('\n') || 'No deals found this morning.';
  if (!profile.ntfyTopic) return { sent: false, body, reason: 'No ntfy topic set' };

  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(profile.ntfyTopic)}`, {
    method: 'POST',
    body,
    headers: { Title: "Today's cheapest deals", Tags: 'leaves', Priority: '3' },
  });
  return { sent: res.ok, body, reason: res.ok ? undefined : `ntfy ${res.status}` };
}
