import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceId } from '@gib/shared';

/**
 * Settings. Defaults below; override in server/data/config.json, e.g.
 *   { "sources": { "sample": false, "weedmaps": true }, "port": 8787 }
 */
export interface Config {
  port: number;
  host: string;
  sources: Record<SourceId, boolean>;
  sourceTimeoutMs: number;
  headless: boolean;          // run the scraping browser hidden
  passcode?: string;          // required to use the site/app when set
  tunnel: boolean;            // public link via Cloudflare quick tunnel
  linkTopic?: string;         // private ntfy topic where the current public link is posted (the Android app reads it)
  publishData?: boolean;      // after the morning refresh, push data to the repo's `data` branch for the GitHub Pages site
}

const defaults: Config = {
  port: 8787,
  host: '0.0.0.0',            // reachable from your phone over Tailscale / LAN
  sources: { sample: true, dutchie: false, jane: false, weedmaps: false, eaze: false },
  sourceTimeoutMs: 8 * 60 * 1000,
  headless: true,
  tunnel: true,
};

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../data/config.json');
const fromFile: Partial<Config> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

export const config: Config = {
  ...defaults,
  ...fromFile,
  sources: { ...defaults.sources, ...(fromFile.sources ?? {}) },
};
