import type { AppliedDeal, Deal, FinePrintItem, Mode, Product, UserProfile } from '@gib/shared';

const lc = (s: string) => s.toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DealContext {
  now: Date;
  mode: Mode;
}

/** Does this deal's schedule/targeting/conditions cover this product right now? (Ignores audience.) */
export function dealMatches(deal: Deal, product: Product, ctx: DealContext): boolean {
  if (deal.storeId !== product.storeId) return false;
  if (deal.days && deal.days.length && !deal.days.includes(ctx.now.getDay())) return false;
  if (deal.conditions.expiresAt && new Date(deal.conditions.expiresAt).getTime() < ctx.now.getTime()) return false;
  if (deal.conditions.pickupOnly && ctx.mode === 'delivery') return false;
  if (deal.conditions.inStoreOnly && ctx.mode === 'delivery') return false;
  if (deal.conditions.deliveryOnly && ctx.mode === 'pickup') return false;
  if (deal.conditions.minThcPct != null && (product.thcPct ?? 0) < deal.conditions.minThcPct) return false;

  const t = deal.appliesTo;
  if (t.productIds?.length && !t.productIds.includes(product.id)) return false;
  if (t.categories?.length && !t.categories.includes(product.category)) return false;
  const brand = lc(product.brand ?? '');
  if (t.brands?.length && !t.brands.some((b) => lc(b) === brand)) return false;
  if (t.excludeBrands?.length && t.excludeBrands.some((b) => lc(b) === brand)) return false;
  if (t.nameIncludes?.length && !t.nameIncludes.some((s) => lc(product.name).includes(lc(s)))) return false;
  if (t.minGrams != null && (product.grams ?? 0) < t.minGrams) return false;
  if (t.maxGrams != null && (product.grams ?? Infinity) > t.maxGrams) return false;
  return true;
}

/** Can this user use this deal? */
export function audienceEligible(deal: Deal, profile: UserProfile, includeFirstTime: boolean): boolean {
  switch (deal.audience) {
    case 'everyone': return true;
    case 'first_time': return includeFirstTime && !profile.visitedStoreIds.includes(deal.storeId);
    case 'veteran': return profile.veteran;
    case 'senior': return profile.senior;
    case 'student': return profile.student;
  }
}

/** Per-unit price after a single deal. Returns the input price if the deal doesn't help. */
export function applyDeal(deal: Deal, price: number): { unit: number; requiresQty?: number } {
  let unit = price;
  let requiresQty: number | undefined;
  const v = deal.value ?? 0;
  switch (deal.kind) {
    case 'percent': unit = price * (1 - v / 100); break;
    case 'amount': unit = Math.max(0, price - v); break;
    case 'fixed': unit = Math.min(price, v); break;
    case 'bundle':
      if (deal.bundleQty && deal.bundlePrice != null) {
        unit = deal.bundlePrice / deal.bundleQty;
        requiresQty = deal.bundleQty;
      }
      break;
    case 'bogo': {
      const n = deal.bogoBuy ?? 1;
      const off = (deal.bogoGetPct ?? 100) / 100;
      unit = (n * price + price * (1 - off)) / (n + 1);
      requiresQty = n + 1;
      break;
    }
  }
  if (unit >= price) return { unit: price };
  return { unit: round2(unit), requiresQty };
}

/** Treat a menu sale price as a deal so it competes with everything else. */
export function salePriceDeal(p: Product): Deal | null {
  if (p.salePrice == null || p.salePrice >= p.price) return null;
  return {
    id: `sale:${p.id}`,
    storeId: p.storeId,
    source: p.source,
    title: p.saleLabel || 'Menu sale price',
    kind: 'fixed',
    value: p.salePrice,
    audience: 'everyone',
    appliesTo: { productIds: [p.id] },
    conditions: {},
    stackable: false,
  };
}

const AUDIENCE_LABEL: Record<string, string> = {
  veteran: 'Veteran', senior: 'Senior', student: 'Student', first_time: 'First-time',
};

/**
 * Best price for one unit given all deals that match + the user is eligible for.
 * Considers each deal alone, and stackable "everyone" deals combined with one audience discount
 * (veteran/senior/student/first-time), which is how most San Diego shops run it.
 */
export function bestDeal(product: Product, deals: Deal[], profile: UserProfile, ctx: DealContext, includeFirstTime: boolean): { applied?: AppliedDeal; used: Deal[] } {
  const all = [...deals];
  const sale = salePriceDeal(product);
  if (sale) all.push(sale);
  const usable = all.filter((d) => dealMatches(d, product, ctx) && audienceEligible(d, profile, includeFirstTime));

  let best: { unit: number; used: Deal[]; requiresQty?: number } = { unit: product.price, used: [] };
  const consider = (unit: number, used: Deal[], requiresQty?: number) => {
    if (unit < best.unit - 0.004) best = { unit, used, requiresQty };
  };

  for (const d of usable) {
    const r = applyDeal(d, product.price);
    consider(r.unit, [d], r.requiresQty);
  }
  const stackBase = usable.filter((d) => d.audience === 'everyone' && d.stackable);
  const audienceDeals = usable.filter((d) => d.audience !== 'everyone' && (d.kind === 'percent' || d.kind === 'amount'));
  for (const base of stackBase) {
    const r1 = applyDeal(base, product.price);
    for (const a of audienceDeals) {
      const r2 = applyDeal(a, r1.unit);
      consider(r2.unit, [base, a], r1.requiresQty);
    }
  }

  if (!best.used.length) return { used: [] };
  const title = best.used
    .map((d) => (d.audience !== 'everyone' && !lc(d.title).includes(lc(AUDIENCE_LABEL[d.audience])) ? `${AUDIENCE_LABEL[d.audience]}: ${d.title}` : d.title))
    .join(' + ');
  const primary = best.used[best.used.length - 1];
  return {
    used: best.used,
    applied: {
      dealId: best.used.map((d) => d.id).join('+'),
      title,
      kind: best.used[0].kind,
      audience: best.used.find((d) => d.audience !== 'everyone')?.audience ?? primary.audience,
      savings: round2(product.price - best.unit),
      effectiveUnitPrice: best.unit,
      requiresQty: best.requiresQty,
    },
  };
}

const IMPORTANT_PATTERNS = [
  /first[- ]time/i, /new (customer|patient)s?/i, /limit/i, /while supplies/i, /cash only/i,
  /exclud/i, /not valid/i, /minimum|min\.? (purchase|order|spend)/i, /in[- ]store only/i,
  /cannot be combined|not combin/i, /select(ed)? (items|brands|strains)/i, /must (buy|purchase)/i, /id required|valid id/i,
];

/** Turn deal conditions + raw fine print into display lines, flagging the ones that can trip you up. */
export function finePrintFor(used: Deal[], itemPrice: number, now: Date): FinePrintItem[] {
  const out: FinePrintItem[] = [];
  const add = (text: string, important: boolean) => {
    if (!out.some((o) => o.text === text)) out.push({ text, important });
  };
  for (const d of used) {
    const c = d.conditions;
    if (d.audience === 'first_time') add('First-time customers only', true);
    if (d.audience === 'veteran') add('Veteran ID required', true);
    if (d.audience === 'senior') add('Senior ID required (usually 60+ or 65+)', true);
    if (d.audience === 'student') add('Valid student ID required', true);
    if (d.kind === 'bundle' && d.bundleQty) add(`Must buy ${d.bundleQty} to get this price`, true);
    if (d.kind === 'bogo') add(`Must buy ${(d.bogoBuy ?? 1) + 1} to get this price`, true);
    if (c.minSpend) add(`Minimum spend $${c.minSpend}`, c.minSpend > itemPrice);
    if (c.limitPerCustomer) add(`Limit ${c.limitPerCustomer} per customer`, true);
    if (c.inStoreOnly) add('In-store only', true);
    if (c.pickupOnly) add('Pickup only', false);
    if (c.deliveryOnly) add('Delivery only', false);
    if (c.cashOnly) add('Cash only', true);
    if (c.idRequired) add('ID required', true);
    if (c.minThcPct) add(`Only products ≥ ${c.minThcPct}% THC`, false);
    if (c.expiresAt) {
      const exp = new Date(c.expiresAt);
      const sameDay = exp.toDateString() === now.toDateString();
      add(sameDay ? 'Ends today' : `Ends ${exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, sameDay);
    }
    if (d.appliesTo.brands?.length) add(`Only ${d.appliesTo.brands.join(', ')}`, false);
    if (d.appliesTo.excludeBrands?.length) add(`Excludes ${d.appliesTo.excludeBrands.join(', ')}`, true);
    if (d.days?.length && d.days.length < 7) {
      const names = d.days.map((i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]).join('/');
      add(`${names} only`, false);
    }
    if (d.finePrint) {
      for (const line of d.finePrint.split(/(?<=[.;])\s+|\n/).map((s) => s.trim()).filter(Boolean)) {
        add(line, IMPORTANT_PATTERNS.some((re) => re.test(line)));
      }
    }
  }
  return out.sort((a, b) => Number(b.important) - Number(a.important));
}
