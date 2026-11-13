import cron, { type ScheduledTask } from 'node-cron';
import { repo } from './db.ts';
import { refreshAll } from './refresh.ts';
import { sendMorningDigest } from './notify.ts';
import { refreshBeer } from './beer/refresh.ts';
import { config } from './config.ts';
import { publishData } from './publish.ts';

let task: ScheduledTask | null = null;

export async function morningJob() {
  console.log('[scheduler] morning refresh starting');
  await Promise.all([refreshAll(), refreshBeer().catch((e) => console.error('[scheduler] beer', e))]);
  if (config.publishData) console.log('[scheduler]', publishData().message);
  const r = await sendMorningDigest();
  console.log(`[scheduler] digest ${r.sent ? 'sent' : `not sent (${r.reason})`}`);
}

/** (Re)schedule the daily refresh at the hour in the user's profile. Local time (America/Los_Angeles). */
export function startScheduler() {
  task?.stop();
  const hour = repo.profile().notifyHour ?? 7;
  task = cron.schedule(`0 ${hour} * * *`, () => { morningJob().catch((e) => console.error('[scheduler]', e)); }, { timezone: 'America/Los_Angeles' });
  console.log(`[scheduler] daily refresh at ${hour}:00 Pacific`);
}
