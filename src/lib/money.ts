import "server-only";
import { DAY, isoDay } from "./format";

// Revenus réels : Stripe (abonnements web) et RevenueCat (abonnements Google Play).
// Clés en lecture seule dans .env.local ; tout est mis en cache 30 min.

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export const clearMoneyCache = () => cache.clear();

// Montants en centimes → unités (les devises sans décimales restent entières).
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp", "xof", "xaf", "pyg", "ugx", "rwf", "kmf", "gnf", "djf", "mga", "bif", "vuv", "xpf"]);
const units = (amount: number, currency: string) => (ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100);

// ── Stripe ───────────────────────────────────────────────────────────────────

type StripeList<T> = { data: T[]; has_more: boolean };
type Price = { id: string; currency: string; unit_amount: number | null; recurring: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null; nickname: string | null };
type Subscription = {
  id: string; status: string; created: number; canceled_at: number | null; cancel_at_period_end: boolean; cancel_at: number | null;
  trial_end: number | null; currency: string; customer: string;
  items: { data: { quantity: number; price: Price }[] };
  // Ancien format (discount) ou récent (discounts, développés) selon la version d'API du compte.
  discount?: Discount | null;
  discounts?: (Discount | string)[];
};
type Coupon = { percent_off: number | null; amount_off: number | null };
type Discount = { coupon?: Coupon | null; source?: { coupon?: Coupon | string | null } | null };
type Charge = { id: string; amount: number; amount_refunded: number; currency: string; created: number; status: string; paid: boolean; refunded: boolean; invoice: string | null; description: string | null };
type Balance = { available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] };

async function stripeGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.STRIPE_READONLY_KEY!;
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com/v1/${path}?${qs}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`Stripe ${path} : ${body?.error?.message ?? res.status}`);
  }
  return (await res.json()) as T;
}

async function stripeAll<T extends { id: string }>(path: string, params: Record<string, string> = {}, max = 5000): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  while (out.length < max) {
    const page = await stripeGet<StripeList<T>>(path, { limit: "100", ...params, ...(after ? { starting_after: after } : {}) });
    out.push(...page.data);
    if (!page.has_more || !page.data.length) break;
    after = page.data[page.data.length - 1].id;
  }
  return out;
}

/** Valeur mensuelle d'une ligne d'abonnement (remise en % ou montant appliquée). */
function monthlyValue(sub: Subscription): number {
  let total = 0;
  for (const item of sub.items.data) {
    const p = item.price;
    if (!p.recurring || p.unit_amount == null) continue;
    const perInterval = units(p.unit_amount, p.currency) * (item.quantity ?? 1);
    const months = { day: 1 / 30, week: 12 / 52, month: 1, year: 12 }[p.recurring.interval] * p.recurring.interval_count;
    total += perInterval / months;
  }
  const discounts = [sub.discount, ...(sub.discounts ?? [])].filter((d): d is Discount => Boolean(d) && typeof d === "object");
  for (const d of discounts) {
    const c = d.coupon ?? (typeof d.source?.coupon === "object" ? d.source.coupon : null);
    if (c?.percent_off) total *= 1 - c.percent_off / 100;
    else if (c?.amount_off) total = Math.max(0, total - units(c.amount_off, sub.currency));
  }
  return total;
}

const planLabel = (sub: Subscription) => {
  const r = sub.items.data[0]?.price.recurring;
  if (!r) return "Autre";
  if (r.interval === "month" && r.interval_count === 1) return "Mensuel";
  if (r.interval === "year" && r.interval_count === 1) return "Annuel";
  return `${r.interval_count} ${r.interval}`;
};

export type StripeStats = Awaited<ReturnType<typeof fetchStripe>>;

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_READONLY_KEY);
}

export function getStripeStats() {
  return cached("stripe", fetchStripe);
}

async function fetchStripe() {
  const since = Math.floor((Date.now() - 400 * DAY) / 1000);
  const [subs, charges, balance] = await Promise.all([
    stripeAll<Subscription>("subscriptions", { status: "all", "expand[]": "data.discounts" }),
    stripeAll<Charge>("charges", { "created[gte]": String(since) }),
    stripeGet<Balance>("balance"),
  ]);

  // Devise principale = celle des abonnements actifs (sinon des paiements).
  const live = subs.filter((s) => ["active", "past_due", "trialing"].includes(s.status));
  const currencyCount = new Map<string, number>();
  [...live.map((s) => s.currency), ...charges.map((c) => c.currency)].forEach((c) => currencyCount.set(c, (currencyCount.get(c) ?? 0) + 1));
  const currency = ([...currencyCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "cad").toUpperCase();
  const otherCurrencies = [...currencyCount.keys()].map((c) => c.toUpperCase()).filter((c) => c !== currency);
  const inMain = (c: string) => c.toUpperCase() === currency;

  const paying = live.filter((s) => s.status !== "trialing");
  const mrr = paying.filter((s) => inMain(s.currency)).reduce((t, s) => t + monthlyValue(s), 0);

  const paid = charges.filter((c) => c.status === "succeeded" && c.paid);
  const daily = new Map<string, { gross: number; refunded: number; count: number }>();
  for (const c of paid.filter((c) => inMain(c.currency))) {
    const d = isoDay(new Date(c.created * 1000));
    const b = daily.get(d) ?? { gross: 0, refunded: 0, count: 0 };
    b.gross += units(c.amount, c.currency);
    b.refunded += units(c.amount_refunded, c.currency);
    b.count++;
    daily.set(d, b);
  }

  const toDay = (ts: number | null) => (ts ? isoDay(new Date(ts * 1000)) : null);
  return {
    currency,
    otherCurrencies,
    mrr,
    arr: mrr * 12,
    active: paying.length,
    trialing: live.filter((s) => s.status === "trialing").length,
    pastDue: live.filter((s) => s.status === "past_due").length,
    cancelScheduled: live.filter((s) => s.cancel_at_period_end || s.cancel_at).length,
    arpu: paying.length ? mrr / paying.length : null,
    planMix: Object.entries(
      paying.reduce<Record<string, number>>((m, s) => ((m[planLabel(s)] = (m[planLabel(s)] ?? 0) + 1), m), {}),
    ).map(([name, value]) => ({ name, value })),
    // Événements d'abonnement datés, filtrés par période dans la page.
    subEvents: subs.map((s) => ({ created: toDay(s.created)!, canceled: toDay(s.canceled_at), trial: Boolean(s.trial_end) })),
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v, net: v.gross - v.refunded })).sort((a, b) => a.date.localeCompare(b.date)),
    // Paiements uniques (achat « à vie ») = paiements sans facture d'abonnement.
    oneTime: paid.filter((c) => !c.invoice && inMain(c.currency)).map((c) => ({ date: toDay(c.created)!, amount: units(c.amount - c.amount_refunded, c.currency) })),
    failed: charges.filter((c) => c.status === "failed").map((c) => toDay(c.created)!),
    balance: {
      available: balance.available.filter((b) => inMain(b.currency)).reduce((t, b) => t + units(b.amount, b.currency), 0),
      pending: balance.pending.filter((b) => inMain(b.currency)).reduce((t, b) => t + units(b.amount, b.currency), 0),
    },
  };
}

// ── RevenueCat ───────────────────────────────────────────────────────────────

export type RevenueCatStats = { currency: string; metrics: Record<string, { name: string; value: number; period: string; unit: string }> };

export function revenueCatConfigured() {
  return Boolean(process.env.REVENUECAT_API_KEY && process.env.REVENUECAT_PROJECT_ID);
}

export function getRevenueCatStats() {
  return cached("revenuecat", async (): Promise<RevenueCatStats> => {
    const res = await fetch(`https://api.revenuecat.com/v2/projects/${process.env.REVENUECAT_PROJECT_ID}/metrics/overview`, {
      headers: { Authorization: `Bearer ${process.env.REVENUECAT_API_KEY}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(`RevenueCat : ${body?.message ?? res.status}`);
    }
    const data = (await res.json()) as { currency: string; metrics: { id: string; name: string; value: number; period: string; unit: string }[] };
    return { currency: data.currency, metrics: Object.fromEntries(data.metrics.map((m) => [m.id, m])) };
  });
}

/** Exécute une source sans faire tomber la page si elle échoue. */
export async function settle<T>(enabled: boolean, fn: () => Promise<T>): Promise<{ data: T | null; error: string | null; enabled: boolean }> {
  if (!enabled) return { data: null, error: null, enabled };
  try {
    return { data: await fn(), error: null, enabled };
  } catch (e) {
    return { data: null, error: (e as Error).message, enabled };
  }
}
