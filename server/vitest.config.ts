import { defineConfig } from 'vitest/config';

// The tests build dates in local time and expect San Diego's clock, so pin the time zone
// (GitHub's machines run in UTC; this also works on Windows, unlike TZ=... in the npm script).
export default defineConfig({ test: { env: { TZ: 'America/Los_Angeles' } } });
