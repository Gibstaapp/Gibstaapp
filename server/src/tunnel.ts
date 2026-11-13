import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { repo } from './db.ts';

/**
 * Public link via Cloudflare quick tunnel (no account). The URL is random and changes whenever the
 * tunnel restarts, so we:
 *  - publish it to a private ntfy topic (config.linkTopic) that the Android app reads to find the server,
 *  - push it to the user's notification topic when it changes,
 *  - health-check it and restart the tunnel if it stops answering.
 */
const here = dirname(fileURLToPath(import.meta.url));
const EXE = resolve(here, '../../tools/cloudflared.exe');
const HEALTH_EVERY_MS = 4 * 60_000;
const REPUBLISH_EVERY_MS = 6 * 60 * 60_000; // ntfy keeps messages ~12h

let child: ChildProcess | null = null;
let publicUrl: string | null = null;
let stopping = false;
let failures = 0;
let timersStarted = false;

export const getPublicUrl = () => publicUrl;

async function ntfy(topic: string, body: string, headers: Record<string, string> = {}) {
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', body, headers });
  } catch (e) {
    console.error('[tunnel] ntfy failed', (e as Error).message);
  }
}

async function publishLink(url: string, changed: boolean) {
  if (config.linkTopic) await ntfy(config.linkTopic, url);
  const userTopic = repo.profile().ntfyTopic;
  if (changed && userTopic) await ntfy(userTopic, `New Gibstaapp link: ${url}`, { Title: 'Gibstaapp link changed', Tags: 'link', Click: url });
}

function restart(reason: string) {
  console.warn(`[tunnel] restarting: ${reason}`);
  child?.kill(); // exit handler starts a new one
}

async function healthCheck() {
  if (!publicUrl || !child) return;
  try {
    const res = await fetch(`${publicUrl}/manifest.webmanifest`, { signal: AbortSignal.timeout(20_000) });
    failures = res.ok ? 0 : failures + 1;
  } catch {
    failures++;
  }
  if (failures >= 2) { failures = 0; restart('public link not answering'); }
}

export function startTunnel() {
  if (!config.tunnel) return;
  if (!existsSync(EXE)) { console.warn(`[tunnel] ${EXE} not found; public link disabled`); return; }
  stopping = false;
  failures = 0;
  child = spawn(EXE, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${config.port}`], { windowsHide: true });
  const onData = (buf: Buffer) => {
    const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== publicUrl) {
      publicUrl = m[0];
      console.log(`[tunnel] public link: ${publicUrl}`);
      publishLink(publicUrl, true);
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('exit', (code) => {
    publicUrl = null;
    child = null;
    if (stopping) return;
    console.warn(`[tunnel] exited (${code}); starting a new one in 5s`);
    setTimeout(startTunnel, 5_000);
  });

  if (!timersStarted) {
    timersStarted = true;
    setInterval(healthCheck, HEALTH_EVERY_MS);
    setInterval(() => { if (publicUrl) publishLink(publicUrl, false); }, REPUBLISH_EVERY_MS);
    const stop = () => { stopping = true; child?.kill(); };
    process.once('exit', stop);
    process.once('SIGINT', () => { stop(); process.exit(0); });
  }
}
