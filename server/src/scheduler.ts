import cron, { type ScheduledTask } from 'node-cron';
import { repo } from './db.ts';
import { refreshAll } from './refresh.ts';
import { sendMorningDigest } from './notify.ts';
import { BEER_REFRESH_TIME_ZONE, refreshBeer } from './beer/refresh.ts';
import { config } from './config.ts';
import { publishData } from './publish.ts';

let task: ScheduledTask | null = null;
let athensTask: ScheduledTask | null = null;
let nycTask: ScheduledTask | null = null;

export async function morningJob() {
  console.log('[scheduler] morning refresh starting');
  await Promise.all([refreshAll({ region: 'us' }), refreshBeer({ region: 'us' }).catch((e) => console.error('[scheduler] beer', e))]);
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
  // Athens has its own daily beer refresh (euros), at 7 AM Athens time.
  athensTask?.stop();
  athensTask = cron.schedule('0 7 * * *', () => {
    refreshBeer({ region: 'europe' })
      .then(() => { if (config.publishData) console.log('[scheduler athens]', publishData().message); })
      .catch((e) => console.error('[scheduler athens]', e));
  }, { timezone: BEER_REFRESH_TIME_ZONE.europe });
  console.log('[scheduler] Athens beer refresh at 7:00 Athens time');
  // New York has its own daily refresh (weed + beer, dollars), at 7 AM New York time.
  nycTask?.stop();
  nycTask = cron.schedule('0 7 * * *', () => {
    Promise.all([
      refreshAll({ region: 'nyc' }).catch((e) => console.error('[scheduler nyc] weed', e)),
      refreshBeer({ region: 'nyc' }).catch((e) => console.error('[scheduler nyc] beer', e)),
    ]).then(() => { if (config.publishData) console.log('[scheduler nyc]', publishData().message); });
  }, { timezone: BEER_REFRESH_TIME_ZONE.nyc });
  console.log('[scheduler] New York refresh at 7:00 New York time');
}
