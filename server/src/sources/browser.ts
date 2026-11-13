import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.ts';

/**
 * Shared Playwright browser for sources that need a real browser (Weedmaps, Eaze, and as a
 * fallback for others). One browser per refresh; each source gets its own context.
 */
let browser: Browser | null = null;
let users = 0;

export async function withContext<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  if (!browser) browser = await chromium.launch({ headless: config.headless });
  users++;
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    geolocation: { latitude: 32.8566, longitude: -117.2091 },
    permissions: ['geolocation'],
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch(() => {});
    users--;
    if (users === 0 && browser) {
      const b = browser;
      browser = null;
      await b.close().catch(() => {});
    }
  }
}

/** Collect JSON bodies of responses whose URL matches `pattern` while `action` runs. */
export async function captureJson(page: Page, pattern: RegExp, action: () => Promise<unknown>, settleMs = 2500): Promise<{ url: string; json: any }[]> {
  const out: { url: string; json: any }[] = [];
  const handler = async (res: import('playwright').Response) => {
    if (!pattern.test(res.url())) return;
    try { out.push({ url: res.url(), json: await res.json() }); } catch { /* not JSON */ }
  };
  page.on('response', handler);
  try {
    await action();
    await page.waitForTimeout(settleMs);
  } finally {
    page.off('response', handler);
  }
  return out;
}

/** Polite delay between requests to the same site. */
export const pause = (ms = 600 + Math.random() * 800) => new Promise((r) => setTimeout(r, ms));
