/**
 * Pull happy-hour windows and beer prices out of plain website text.
 * Bars write these a hundred different ways, so this is deliberately forgiving and
 * only keeps things it's fairly sure about. Everything found is shown with the original
 * snippet so people can judge it themselves.
 */

export interface FoundWindow { days: number[]; start: string; end: string; text: string }
export interface FoundPrice { item: string; price: number; size?: string; happyHour: boolean; text: string }

const DAY_NAMES: [RegExp, number][] = [
  [/^sun/i, 0], [/^mon/i, 1], [/^tue/i, 2], [/^wed/i, 3], [/^thu/i, 4], [/^fri/i, 5], [/^sat/i, 6],
];
const DAY = String.raw`(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|s|\.)?`;

function dayIndex(word: string): number | null {
  for (const [re, i] of DAY_NAMES) if (re.test(word.trim())) return i;
  return null;
}

/** "Mon-Fri", "Monday through Thursday", "weekdays", "daily", "Tue & Thu" -> [days] */
export function parseDays(text: string): number[] | null {
  const t = text.toLowerCase();
  if (/\b(daily|every ?day|7 days|seven days|all week)\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const range = new RegExp(String.raw`\b(${DAY})\s*(?:-|–|—|thru|through|to|until)\s*(${DAY})`, 'i').exec(t);
  if (range) {
    const a = dayIndex(range[1]), b = dayIndex(range[2]);
    if (a != null && b != null) {
      const out: number[] = [];
      for (let d = a; ; d = (d + 1) % 7) { out.push(d); if (d === b || out.length > 7) break; }
      return out;
    }
  }
  if (/\bweekdays?\b/.test(t)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(t)) return [0, 6];
  const singles = [...t.matchAll(new RegExp(String.raw`\b(${DAY})\b`, 'gi'))].map((m) => dayIndex(m[1])).filter((d): d is number => d != null);
  return singles.length ? [...new Set(singles)].sort() : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function to24(h: number, m: number, ap: string | undefined, fallbackAp?: string): string | null {
  if (h > 24 || m > 59) return null;
  const mer = (ap ?? fallbackAp ?? '').toLowerCase().replace(/\./g, '');
  if (mer.startsWith('p') && h < 12) h += 12;
  if (mer.startsWith('a') && h === 12) h = 0;
  if (!mer && h >= 1 && h <= 9) h += 12; // "3-6" at a bar means afternoon
  return `${pad(h % 24)}:${pad(m)}`;
}

/** "3-6pm", "3:00 PM – 6:00 PM", "4pm to close", "2 - 5" -> {start, end} */
export function parseTimeRange(text: string): { start: string; end: string } | null {
  const re = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to|until|til|'til|till)\s*(?:(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?|(close|closing))/i;
  const m = re.exec(text);
  if (!m) return null;
  const endAp = m[6];
  const start = to24(+m[1], +(m[2] ?? 0), m[3], m[3] ? undefined : endAp);
  const end = m[7] ? '02:00' : to24(+m[4], +(m[5] ?? 0), endAp, undefined);
  if (!start || !end || start === end) return null;
  // Sanity: happy hours start between 10am and 11pm (or late-night reverse happy hours)
  const sh = +start.slice(0, 2);
  if (sh < 10 && sh > 2) return null;
  return { start, end };
}

const BEER_WORD = String.raw`(?:drafts?|draughts?|pints?|beers?|brews?|taps?|domestics?|crafts?|tall ?boys?|lagers?|ipas?|pilsners?|bottles?|cans?|mich(?:elob)?(?: ultra)?|coors(?: light)?|bud(?: light)?|modelo|pacifico|tecate|corona|stella|blue moon|pbr|miller(?: lite)?|house beers?)`;
// Not beer, or not a single beer: wine/soda/food/etc. near the price.
const NOT_BEER_CONTEXT = /\b(wine|glass|soda|juice|coke|sprite|lemonade|iced tea|coffee|kombucha|root beer|ginger beer|ice cream|float|soaked|battered|fried|cheese|sauce|bratwurst|upgrade)\b/i;
const SKIP_WORD = /pitcher|bucket|tower|growler|keg|flight|off\b|wings?|tacos?|food|wine|wells?|cocktail|margarita|shot|sliders?|fries|burger|pizza|appetizer/i;

/** "$5 drafts", "$4 domestic pints", "Pints $6", "Coors Light - $3.50" */
export function parsePrices(text: string, happyHour: boolean): FoundPrice[] {
  const out: FoundPrice[] = [];
  const before = new RegExp(String.raw`\$\s?(\d{1,2}(?:\.\d{2})?)\s+((?:[a-z]+ ){0,2}${BEER_WORD})`, 'gi');
  const after = new RegExp(String.raw`(${BEER_WORD}(?: (?!and\b|or\b|with\b|plus\b|&)[a-z]+){0,2})\s*(?:[:\-–]|for|are|just|only)?\s*\$\s?(\d{1,2}(?:\.\d{2})?)`, 'gi');
  const push = (price: number, item: string, at: number, end: number) => {
    // '$7 wells' after a beer word: the price belongs to the next thing
    if (end >= 0 && SKIP_WORD.test(text.slice(end, end + 14))) return;
    const ctx = text.slice(Math.max(0, at - 25), at + item.length + 30);
    if (SKIP_WORD.test(item) || NOT_BEER_CONTEXT.test(text.slice(Math.max(0, at - 30), (end >= 0 ? end : at + item.length + 8) + 12)) || /\$\s?\d+(?:\.\d{2})?\s*off/i.test(ctx.slice(20, 45))) return;
    if (price < 1.5 || price > 15) return;
    const clean = item.trim().replace(/\s+/g, ' ');
    if (out.some((o) => o.price === price && o.item.toLowerCase() === clean.toLowerCase())) return;
    const size = /pint/i.test(clean) ? 'pint' : /tall ?boy/i.test(clean) ? '24oz' : /\b(can|bottle)s?\b/i.test(clean) ? '12oz' : undefined;
    out.push({ item: cap(clean), price, size, happyHour, text: squish(text.slice(Math.max(0, at - 60), at + 80)) });
  };
  // '$5 drafts' style only in happy-hour text; on menus the price follows the name ('Modelo $7').
  if (happyHour) for (const m of text.matchAll(before)) push(+m[1], m[2], m.index ?? 0, -1);
  for (const m of text.matchAll(after)) push(+m[2], m[1], m.index ?? 0, (m.index ?? 0) + m[0].length);
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const squish = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Find happy-hour windows (and the beer prices near them) in a page's text. */
export function extractHappyHour(pageText: string): { windows: FoundWindow[]; prices: FoundPrice[] } {
  const text = squish(pageText);
  const windows: FoundWindow[] = [];
  const prices: FoundPrice[] = [];
  const re = /happy\s*hour|reverse\s*happy|social\s*hour|half\s*off\s*drafts/gi;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    const chunk = text.slice(Math.max(0, at - 120), at + 320);
    // Only look right after the words 'happy hour' so nearby events don't leak in.
    const after = text.slice(at, at + 160);
    const time = parseTimeRange(after);
    const days = parseDays(after) ?? parseDays(text.slice(Math.max(0, at - 40), at)) ?? []; // [] = days not listed
    if (time && !windows.some((w) => w.start === time.start && w.end === time.end && w.days.join() === days.join())) {
      windows.push({ ...time, days, text: squish(chunk) });
    }
    for (const p of parsePrices(text.slice(at, at + 400), true)) {
      if (!prices.some((x) => x.price === p.price && x.item === p.item)) prices.push(p);
    }
  }
  return { windows: windows.slice(0, 4), prices: prices.slice(0, 8) };
}

/** HTML -> visible text (good enough: no scripts/styles, tags to spaces, entities decoded). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#36;|&dollar;/g, '$').replace(/&ndash;|&#8211;/g, '–').replace(/&mdash;|&#8212;/g, '—')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, ' ');
}
