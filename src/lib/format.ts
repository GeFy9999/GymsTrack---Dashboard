const nf = new Intl.NumberFormat("fr-FR");
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : nf.format(Math.round(n)));
export const fmt1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : nf1.format(n));
export const pct = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits).replace(".", ",")} %`;
export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export const DAY = 86_400_000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(iso) + n * DAY));
export const today = () => isoDay(new Date());

export function daysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Date FR sans décalage de fuseau pour un jour "YYYY-MM-DD". */
export const frDate = (iso: string | null, opts: Intl.DateTimeFormatOptions = {}) =>
  iso ? new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso).toLocaleDateString("fr-FR", opts) : "—";

export const weight = (kg: number) => (kg >= 1000 ? `${fmt1(kg / 1000)} t` : `${fmt(kg)} kg`);
