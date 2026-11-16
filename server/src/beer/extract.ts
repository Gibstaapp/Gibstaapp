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
  // Over 10 hours is opening hours, not a happy hour ("6:00 - 11:00" dinner, "3PM-12AM"), unless the end is spelled
  // out as late night ("4 p.m. - 4 a.m.", "2PM-Close").
  const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
  if ((mins(end) - mins(start) + 1440) % 1440 > 600 && !m[7] && !/^a/i.test(endAp ?? '')) return null;
  // Sanity: happy hours start between 10am and 11pm (or late-night reverse happy hours)
  const sh = +start.slice(0, 2);
  if (sh < 10 && sh > 2) return null;
  return { start, end };
}

const BEER_WORD = String.raw`(?:drafts?|draughts?|pints?|beers?|brews?|taps?|domestics?|crafts?|tall ?boys?|lagers?|ipas?|pilsners?|bottles?|cans?|mich(?:elob)?(?: ultra)?|coors(?: light)?|bud(?: light)?|modelo|pacifico|tecate|corona|stella|blue moon|pbr|miller(?: lite| high life)?|house beers?)`;
// Not beer, or not a single beer: wine/soda/food/etc. near the price.
const NOT_BEER_CONTEXT = /\b(wine|glass|soda|juice|coke|sprite|lemonade|iced tea|coffee|kombucha|root beer|ginger beer|ice cream|float|soaked|battered|fried|cheese|sauce|bratwurst|upgrade|cocktails?|highballs?|spritz|champagne|mimosas?|all you can|spaghetti|pinot|cabernet|chardonnay|sauvignon|merlot|ros[eé]|prosecco|seltzers?|aperol|campari|vodka|mezcal|bitters)\b/i;
const SKIP_WORD = /pitcher|bucket|tower|growler|keg|flight|off\b|wings?|tacos?|food|wine|wells?|cocktail|margarita|mimosa|champagne|shot|sliders?|fries|burger|pizza|appetizer/i;

/** What comes right before the first price of a price-first list: a time, a heading, "only", a day... */
const PRICE_FIRST_LEAD = /(?:\d\s*(?:a\.?m\.?|p\.?m\.?)\s*[\])]?|\bonly|\bhours?!?|\bdaily|\bweekdays?|\bm\s*-\s*f|[a-z]days?|\bclose|\bnight!?|\ball day|\bspecials?|\bdeals?|\bfeaturing|[:!\]|–-])\s*$/i;

/** An item's name right before a price ("Coors Light Draft $5", "Apps $10"). */
const NAME_LEAD = /(?:\b[A-Z][\w'’.&/-]*|\b(?:beers?|drafts?|lagers?|ipas?|pilsners?|light|ultra|wines?|apps|cocktails?|liquor|spritz|margaritas?|martinis?))\s*[:\-–]?\s*$/;

/** "$5 drafts", "$4 domestic pints", "Pints $6", "Coors Light - $3.50" */
export function parsePrices(text: string, happyHour: boolean): FoundPrice[] {
  const out: FoundPrice[] = [];
  const before = new RegExp(String.raw`\$\s?(\d{1,2}(?:\.\d{2})?)\s+((?:[a-z]+ ){0,2}${BEER_WORD})\b`, 'gi');
  const after = new RegExp(String.raw`\b(${BEER_WORD}\b(?: (?!and\b|or\b|with\b|plus\b|&)[a-z]+){0,2})\s*(?:[:\-–]|for|are|just|only)?\s*\$\s?(\d{1,2}(?:\.\d{2})?)`, 'gi');
  let blockPriceFirst = false; // set below, once the block's style is known
  const push = (price: number, item: string, at: number, endIn: number) => {
    const sure = endIn === -2; // price-first list: the price is this item's
    const end = endIn === -2 ? -1 : endIn;
    // '$7 wells' after a beer word: the price belongs to the next thing
    if (end >= 0 && SKIP_WORD.test(text.slice(end, end + 14))) return;
    const ctx = text.slice(Math.max(0, at - 25), at + item.length + 30);
    // Nearby words that say "not beer": up to 12 chars past the price, or for "$5 drafts" style up to the next price.
    const itemEnd = end >= 0 ? end : text.indexOf(item, at) + item.length;
    const ctxEnd = end >= 0 ? end + 12 : itemEnd + (/\$/.exec(text.slice(itemEnd, itemEnd + 12))?.index ?? 12);
    if (SKIP_WORD.test(item) || NOT_BEER_CONTEXT.test(text.slice(Math.max(0, at - 30), ctxEnd)) || /\$\s?\d+(?:\.\d{2})?\s*off/i.test(ctx.slice(20, 45))) return;
    if (price < 1.5 || price > 15) return;
    const lead = text.slice(Math.max(0, at - 24), at);
    // Text right after the price (name-then-price) or right after the name ("$5 drafts"-style).
    const after0 = end >= 0 ? end : text.indexOf(item, at) + item.length;
    const tail = text.slice(after0, after0 + 30);
    // "$5 Boot Brew – any draft $7 & under": $7 is the limit, not a price.
    if (end >= 0 && /^\s*(?:&|and|or)\s*(?:under|less|below)\b/i.test(tail)) return;
    // "$8 can of Modelo and a shot of tequila", "$10 beer, shot & 6 wings": a combo, not the price of a beer.
    // (After a name-then-price match only the words between name and price count: the next line may be a shot.)
    if (/^[^$]{0,22}\bshots?\b/i.test(end >= 0 ? text.slice(at + item.length, end) : tail) || /\bshot\b[^$]{0,12}$/i.test(lead)) return;
    // "Burger served with fries & a pint of house lager $15": the beer comes with the food.
    if (/(?:&|\band\b|\bwith\b|\bw\/)\s*(?:an?\s+)?(?:pint|glass|can|bottle|draft)s?\s+of\s+(?:[\w'’]+\s+){0,2}$/i.test(text.slice(Math.max(0, at - 40), at))) return;
    // Non-alcoholic beer isn't a beer deal ("Athletic Free Wave Hazy IPA", "N/A Heineken 0.0").
    // (Only this item's own words: back to the previous price, so a "NON-ALCOHOLIC" heading doesn't hide the beers under it.)
    const own = text.slice(Math.max(0, at - 45), at).split(/\$\s?\d/).pop() + item;
    if (/\b(?:athletic|non[- ]?alc\w*|alcohol[- ]free|n\/a|na beer|0\.0)\b/i.test(own)) return;
    // "... Drive Pilsner $9 0.0% ABV", "Less than 0.05% ABV"
    if (end >= 0 && /^\s*(?:less than\s+)?0\.\d+\s*%|^\s*(?:non[- ]?alc|alcohol[- ]free)/i.test(tail)) return;
    // "$10 Coors Light $7": on a name-then-price menu the $10 belongs to the item before. When the two prices disagree,
    // the one after the name wins (that match is read separately).
    // ("$4 miller high life $8 Wine" is price-first all the way: the $8 is the wine's, so the $4 stands.)
    // In a price-first block, "Bottled Beers $6" right after "$5" is the start of the next item, not its price;
    // a name with no price just before it ("HAPPY HOUR Miller Lite / Coors Light Draft $5") is still name-then-price.
    if (end >= 0 && blockPriceFirst && /\$\s?\d/.test(text.slice(Math.max(0, at - 45), at))) return;
    // "Coors Light Draft $5 Harpoon Draft, Kona Draft $7": a price right after a name, with no other price just
    // before that name, is that name's price (whatever the rest of the block looks like).
    if (end < 0) {
      const leadIn = text.slice(Math.max(0, at - 45), at);
      if (!/\$\s?\d/.test(leadIn) && !PRICE_FIRST_LEAD.test(leadIn) && NAME_LEAD.test(leadIn)) return;
    }
    if (end < 0 && !sure) {
      const next = /^\s*[:\-–]?\s*\$\s?(\d{1,2}(?:\.\d{2})?)/.exec(tail);
      if (next && +next[1] !== price && !SKIP_WORD.test(text.slice(after0 + next[0].length, after0 + next[0].length + 14))) return;
    }
    // "+$2 ..." is an add-on, "2 Tacos + Mexican Lager $14" is a combo: neither is the price of a beer.
    // ("BEER + SELTZER + NON-ALCOHOLIC Coors Light $8" is a heading, not an add-on: all-caps words are fine.)
    const plus = /\+\s*((?:[\p{L}-]+ ){0,2})$/u.exec(lead);
    if (plus && !(plus[1].trim() && plus[1] === plus[1].toUpperCase())) return;
    // "Nachos & a Beer $14", "Pizza and a Pint $17": a food combo, not the price of a beer.
    if (/(?:&|\band\b|\bw\/|\bwith\b)\s*(?:an?\s+)?$/i.test(lead) || /(?:&|\band\b|\bwith\b)\s*(?:an?\s+)?$/i.test(text.slice(Math.max(0, at - 10), at))) return;
    // "$6 until 6pm": a timed special we can't place, so don't show it as the everyday price.
    if (!happyHour && end >= 0 && /^\s*(?:until|till?|before)\s+\d/i.test(text.slice(end, end + 16))) return;
    let clean = item.trim().replace(/\s+/g, ' ');
    // Brand words just before the beer word belong to its name: "Fiddlehead IPA $11", "Threes Vliet Pilsner $8".
    // Only Capitalized words (not "and enjoy our IPA"), and never menu headings ("Draft Beer", "Bottles").
    if (end >= 0) {
      const words = text.slice(Math.max(0, at - 40), at).trimEnd().split(/\s+/);
      const brand: string[] = [];
      while (brand.length < 3 && words.length) {
        const w = words.pop()!;
        // Not brand words: headings, "TO ANY", "ABV", and state/country codes from the line before ("Coney Island, NY").
        if (!/^[A-Z][\w'’.&-]*$/.test(w) || /^[A-Z]{2}$/.test(w) || /^(beers?|drafts?|draughts?|bottles?|cans?|on|tap|menu|happy|hour|wines?|cocktails?|and|the|our|all|select|to|any|add|per|of|for|abv|ibu|ask|bartender|server|BEERS?|DRAFTS?)$/i.test(w)) break;
        brand.unshift(w);
      }
      if (brand.length) clean = `${brand.join(' ')} ${clean}`;
    }
    // "[4pm - 8pm] $5 Bottled Beers $6 Drafts" read as a menu: a plain "Bottled Beers" with a different price right
    // before it, itself after a time or heading, is a price-first list: the $6 after it is the next item's.
    // ("Apps $10 Draft Beer $5" is name-first: there the $10 follows a name, and the $5 stands.)
    if (end >= 0 && /^(?:bottled |canned |draft |domestic |craft |house )?(?:beers?|drafts?|bottles?|cans?|pints?)$/i.test(clean)) {
      const pre = /\$\s?(\d{1,2}(?:\.\d{2})?)\s+(?:[A-Za-z]+\s+){0,2}$/.exec(text.slice(Math.max(0, at - 30), at));
      if (pre && +pre[1] !== price && PRICE_FIRST_LEAD.test(text.slice(Math.max(0, at - 30 - 30 + (pre.index ?? 0)), Math.max(0, at - 30) + (pre.index ?? 0)))) return;
    }
    // A plural menu heading in front of the beer isn't part of its name: "Bottles Pacifico $8" -> "Pacifico".
    clean = clean.replace(/^(?:bottles|cans|beers)\s+(?=\S)/i, '');
    // On a regular menu a lone "Beer(s)" / "Draft" / "IPA" names nothing you could order.
    if (!happyHour && /^(beers?|drafts?|draughts?|ipas?|lagers?|ales?|pilsners?|stouts?)$/i.test(clean)) return;
    // A bare "Can" or "Bottles" says nothing, and "Beer Mondays" is the name of the special, not the beer.
    if (/^(cans?|bottles?)$/i.test(clean) || /\b(mon|tues|wednes|thurs|fri|satur|sun)days?$/i.test(clean)) return;
    if (out.some((o) => o.price === price && o.item.toLowerCase() === clean.toLowerCase())) return;
    const size = /pint/i.test(clean) ? 'pint' : /tall ?boy/i.test(clean) ? '24oz' : /\b(can|bottle)s?\b/i.test(clean) ? '12oz' : undefined;
    out.push({ item: cap(clean), price, size, happyHour, text: squish(text.slice(Math.max(0, at - 60), at + 80)) });
  };
  // '$5 drafts' style only in happy-hour text; on menus the price follows the name ('Modelo $7').
  // Happy-hour text comes in two styles, told apart by what's right before its first price:
  //   price-first  "Monday - Friday [4pm - 8pm] $5 Bottled Beers $6 Drafts $8 Pinot"  (a time or heading)
  //   name-first   "4pm – 7pm Wines $8 Draught Beers $7 Bottles/Cans $6"               (an item's name)
  // In a price-first list each price goes with the words after it, so the name-then-price reading is skipped there.
  const first = /\$\s?\d/.exec(text);
  const lead0 = first ? text.slice(Math.max(0, first.index - 30), first.index) : '';
  const priceFirst = happyHour && !!first && PRICE_FIRST_LEAD.test(lead0);
  // Name-first when the first price follows a name ("Coors Light Draft $5 Harpoon Draft, Kona Draft $7": the $5 isn't Harpoon's).
  const nameFirst = happyHour && !priceFirst && NAME_LEAD.test(lead0);
  // Some sites print every price twice, before and after the name ("$ 10 Well Liquor $ 10 DRAFT $ 7 Founders Lager $ 7"):
  // there both readings agree for real items, and a price that differs on the two sides isn't trusted.
  const doubled = [...text.matchAll(/\$\s?(\d{1,2}(?:\.\d{2})?)\s+[^$]{2,60}?\s*\$\s?\1(?![\d.])/g)].length >= 2;
  if (happyHour && !nameFirst) for (const m of text.matchAll(before)) push(+m[1], m[2], m.index ?? 0, priceFirst && !doubled ? -2 : -1);
  blockPriceFirst = priceFirst && !doubled;
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
    // Only look right after the words 'happy hour' so nearby events don't leak in, and stop where the site moves on to
    // its opening hours or another menu ("Happy Hour  Events  Hours of Operation Monday 3:00 pm – 12:00 am").
    let after = text.slice(at, at + 160);
    const stop = /\b(?:hours of operation|opening hours|(?<!happy\s?)hours\b|kitchen|dinner|brunch|lunch menu|location|address)/i.exec(after.slice(m[0].length + 2));
    if (stop) after = after.slice(0, m[0].length + 2 + stop.index);
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

// ---------- Euro menus (Athens): "Mythos 500ml 4,50€", "€5 draft", "Μπύρα βαρέλι 0,5L 5 €" ----------

// Beer words in English and Greek, plus brands you see on Athens menus. Matched as whole words in any alphabet.
const EU_BEER = String.raw`(?:drafts?|draughts?|pints?|beers?|lagers?|pils(?:ner)?|ipas?|ales?|stouts?|weiss(?:bier)?|wheat|bottles?|cans?|on tap|`
  + String.raw`μπ[υύ]ρ(?:α|ες|ας)|μπ[ιί]ρ(?:α|ες|ας)|βαρ[εέ]λ(?:ι|ια|ιού)|φιάλη|κουτάκι|`
  + String.raw`mythos|μ[υύ]θος|fix|φιξ|alfa|[αά]λφα|vergina|βεργ[ιί]να|kaiser|amstel|heineken|nymfi|ν[υύ]μφη|septem|zeos|volkan|mamos|μ[αά]μος|`
  + String.raw`kozel|pilsner urquell|stella(?: artois)?|corona|erdinger|paulaner|guinness|fischer|krombacher|leffe|hoegaarden|carlsberg|tuborg|peroni|estrella|kirin|`
  + String.raw`noctua|marea|siris|chios|corfu|koryfo|κορυφ[ωώ]|craft)`;
// Not beer, or not one beer, near the price.
const EU_NOT_BEER = /(wine|κρασ[ιί]|κτ[ηή]μα|ktima|estate|domaine|οιν[οό]|ασ[υύ]ρτικο|assyrtiko|μαλαγουζι|malagouzia|ξιν[οό]μαυρο|xinomavro|αγιωργ[ιί]τικο|agiorgitiko|μοσχοφ[ιί]λερο|moschofilero|ροδ[ιί]της|roditis|σαββατιαν|savatiano|βηλαν|vidiano|λημν|muscat|μοσχ[αά]το|sauvignon|chardonnay|merlot|cabernet|syrah|pinot|riesling|ros[eé]\b|ροζ[εέ]|prosecco|champagne|σαμπ[αά]νια|cocktails?|κοκτ[εέ]ιλ|spirits?|ποτ[οό]\b|σφην|shot|coffee|καφ[εέ]|freddo|espresso|cappuccino|tea\b|τσ[αά]ι|juice|χυμ[οό]ς|soda|αναψυκτικ|water|νερ[οό]|food|burger|pizza|π[ιί]τσα|σαλ[αά]τα|salad|souvlaki|σουβλ|fries|πατ[αά]τες|pitcher|καν[αά]τα|bucket|κουβ[αά]|tower|πύργος|ginger beer|root beer|tonic|τζιν|gin\b|vodka|β[οό]ντκα|rum|ρούμι|whisk|ουίσκι|tequila|mezcal|aperol|spritz|mojito|margarita|sangria)/iu;
const NUM = String.raw`(\d{1,2}(?:[.,]\d{1,2})?)`;
const EURO_AFTER = String.raw`${NUM}\s?(?:€|eur(?:o|os|ώ)?\b|ευρ[ωώ])`;   // 4,50€ / 5 EUR / 5 ευρώ
const EURO_BEFORE = String.raw`€\s?${NUM}`;                                  // €5
const SIZE = String.raw`(?:\d{2,4}\s?ml|\d{1,2}\s?cl|[01][.,]\d{1,2}\s?(?:l|lt|λτ)\b|pint|μεγ[αά]λη|μικρ[ηή])`;
const ABV = String.raw`(?:[\s–\-|]*\d{1,2}(?:[.,]\d)?\s?%\s?(?:vol|abv)?[\s–\-|]*)?`;

const euNum = (s: string) => parseFloat(s.replace(',', '.'));
function euSize(s: string): string | undefined {
  const m = /(\d{2,4})\s?ml/i.exec(s) ?? null;
  if (m) return `${m[1]}ml`;
  const cl = /(\d{1,2})\s?cl/i.exec(s);
  if (cl) return `${+cl[1] * 10}ml`;
  const l = /([01][.,]\d{1,2})\s?(?:l|lt|λτ)\b/i.exec(s);
  if (l) return `${Math.round(euNum(l[1]) * 1000)}ml`;
  if (/pint/i.test(s)) return 'pint';
  return undefined;
}

/** Euro beer prices in menu or happy-hour text (Greek or English). Strict: unclear lines are skipped, not guessed. */
export function parseEuroPrices(text: string, happyHour: boolean): FoundPrice[] {
  const out: FoundPrice[] = [];
  const W = String.raw`[\p{L}\d][\p{L}\d'’&.\-]*`;
  // "Mythos 500ml 4,50€", "Μπύρα βαρέλι 0,5L – 5 €", "Kaiser 500ml\n5.2% vol –\n4.00€"
  const after = new RegExp(String.raw`(?<![\p{L}])((?:${W} ){0,3}${EU_BEER}(?![\p{L}])(?: (?!and |και |with |με )${W}){0,3}?)\s*(${SIZE})?${ABV}\s*(?:[:\-–|·]\s*)?(?:${EURO_AFTER}|${EURO_BEFORE})(?!\s?\/\s?(?:\d|€))`, 'giu');
  // "€5 draft beers", "5€ μπύρα βαρέλι" (happy-hour style)
  const before = new RegExp(String.raw`(?:${EURO_BEFORE}|${EURO_AFTER})\s+((?:${W} ){0,2}${EU_BEER}(?![\p{L}])(?: (?!and\b|και\b|with\b|με\b|or\b|ή\b)${W}){0,1})`, 'giu');
  const push = (raw: string, item: string, sizeText: string, at: number, len: number) => {
    const price = euNum(raw);
    if (!(price >= 1.5 && price <= 15)) return;
    const ctx = text.slice(Math.max(0, at - 20), at + len + 20);
    if (EU_NOT_BEER.test(item) || EU_NOT_BEER.test(text.slice(at, at + len))) return;
    if (/\d\s?(?:€|eur)\s?\/\s?\d|\d\s?\/\s?\d+\s?(?:€|eur)/i.test(ctx)) return;    // "4€ / 5€": which size is which? skip
    if (/\b(off|έκπτωση|discount|\+)\s*$/i.test(text.slice(Math.max(0, at - 12), at))) return;
    // An item name never spans sentences ("…aromas and flavors. Ale 330ml €7.50" -> "Ale").
    const clean = (item.trim().replace(/\s+/g, ' ').split(/[.;!?]\s+/).pop() ?? '').replace(/[\s:\-–|·]+$/, '');
    // Under a spirits/wine/cocktail heading ("whiskey ... Jameson IPA Edition 10€"), it isn't beer.
    const before = text.slice(Math.max(0, at - 160), at);
    const lastSpirit = before.search(/(whisk(?:e)?y|ουίσκι|gin|τζιν|vodka|β[οό]ντκα|rum|ρούμι|tequila|mezcal|wines?|κρασ|cocktails?|κοκτ[εέ]ιλ|spirits)(?![\p{L}])(?![\s\S]*(?:beers?|μπ[υύ]ρ|draft|βαρ[εέ]λ))/iu);
    if (lastSpirit >= 0) return;
    // One style word alone ("Ale", "IPA") on a menu is usually a description's word next to someone else's price.
    if (!happyHour && /^(?:ales?|ipas?|lagers?|stouts?|porters?|pils(?:ner)?|weiss|wheat|sours?|μπ[υύ]ρα)$/iu.test(clean.replace(/\s*\d{2,4}\s?ml$/i, ''))) return;
    // "440ml Can" alone names no beer.
    if (/^(?:\d{2,4}\s?ml\s*)?(?:cans?|bottles?|κουτ[αά]κι|φι[αά]λη)$/iu.test(clean)) return;
    if (!clean || /^(cans?|bottles?|beers?|μπ[υύ]ρ(?:α|ες))$/iu.test(clean) && !happyHour) return; // bare "Beer 5€" on a menu says too little
    const size = euSize(sizeText || item);
    if (out.some((o) => o.price === price && o.item.toLowerCase() === clean.toLowerCase() && o.size === size)) return;
    out.push({ item: cap(clean), price, size, happyHour, text: squish(text.slice(Math.max(0, at - 40), at + len + 40)) });
  };
  for (const m of text.matchAll(after)) push(m[3] ?? m[4], m[1], m[2] ?? '', m.index ?? 0, m[0].length);
  if (happyHour) for (const m of text.matchAll(before)) push(m[1] ?? m[2], m[3], '', m.index ?? 0, m[0].length);
  return out;
}

/** Happy-hour windows plus euro prices near them. */
export function extractEuroHappyHour(pageText: string): { windows: FoundWindow[]; prices: FoundPrice[] } {
  const { windows } = extractHappyHour(pageText);
  const text = squish(pageText);
  const prices: FoundPrice[] = [];
  for (const m of text.matchAll(/happy\s*hour|χ[αά]πι\s*[αά]ουερ/giu)) {
    const at = m.index ?? 0;
    for (const p of parseEuroPrices(text.slice(at, at + 400), true)) if (!prices.some((x) => x.price === p.price && x.item === p.item)) prices.push(p);
  }
  return { windows, prices: prices.slice(0, 8) };
}
