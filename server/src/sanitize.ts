import type { Deal, Product } from '@gib/shared';

/**
 * Data-quality guards applied after every refresh, so bad menu data doesn't top the rankings.
 */

// Holiday promos dispensaries forget to turn off ("Mother's Day 40% off" in November).
const HOLIDAYS: [RegExp, number[]][] = [
  [/new year/i, [11, 0]],
  [/valentine/i, [1]],
  [/st\.? ?patrick|paddy/i, [2]],
  [/easter/i, [2, 3]],
  [/4\/20|420|four ?twenty/i, [3]],
  [/cinco de mayo|mother'?’?s day|memorial day/i, [4]],
  [/father'?’?s day|juneteenth|pride/i, [5]],
  [/4th of july|fourth of july|independence|7\/10|710|oil day/i, [6]],
  [/labor day/i, [8]],
  [/halloween|spooky/i, [9]],
  [/veterans? day/i, [10]],
  [/thanksgiving|black friday|green friday|cyber monday/i, [10]],
  [/christmas|xmas|hanukkah|holiday/i, [11]],
];

export function isStaleHolidayDeal(d: Deal, now = new Date()): boolean {
  const m = now.getMonth(), day = now.getDate();
  for (const [re, months] of HOLIDAYS) {
    if (!re.test(d.title)) continue; // judge by title only; fine print mentions holidays in passing
    // In season = holiday month, the last ~10 days before it, or the first week after it.
    const inSeason = months.some((h) => h === m || ((h + 11) % 12 === m && day >= 20) || ((h + 1) % 12 === m && day <= 7));
    if (!inSeason) return true;
  }
  return false;
}

/** Minimum believable list price per unit. Anything under this is almost certainly a menu error. */
function implausible(p: Product): boolean {
  if (p.price < 1.5) return true;
  if (p.category === 'edible' && p.thcMg && p.thcMg >= 50 && p.price < 3) return true;
  if (['flower', 'preroll', 'vape', 'concentrate'].includes(p.category) && p.grams && p.price / p.grams < 0.4) return true;
  if (p.salePrice != null && p.salePrice < p.price * 0.15) return true;
  return false;
}

// Topicals/lotions/patches some menus file under concentrates or vapes.
// Word-bounded; "cream" only as body/pain/relief cream so strains like "Ice Cream Cake" stay put.
const TOPICAL = /\b(topicals?|td compound|lotion|balm|salve|transdermal|patch(es)?|bath (bomb|soak|salts?)|massage oil|roll[- ]?on|(body|pain|relief) cream)\b/i;
function recategorize(p: Product): Product {
  if (p.category !== 'other' && p.category !== 'edible' && TOPICAL.test(p.name)) return { ...p, category: 'other', grams: undefined };
  return p;
}

export function sanitize(products: Product[], deals: Deal[], log: (m: string) => void = console.log) {
  const keptProducts = products.map(recategorize).filter((p) => !implausible(p));
  const keptDeals = deals.filter((d) => !isStaleHolidayDeal(d));
  const dp = products.length - keptProducts.length, dd = deals.length - keptDeals.length;
  if (dp || dd) log(`[sanitize] dropped ${dp} implausible products, ${dd} out-of-season holiday deals`);
  return { products: keptProducts, deals: keptDeals };
}
