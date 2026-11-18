import type { ReactNode } from "react";
import { fmt, frDate, pct } from "@/lib/format";

export function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-4 pt-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function Card({ title, hint, children, className = "" }: { title?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl border border-line bg-surface p-4 ${className}`}>
      {title && (
        <div className="mb-3">
          <h3 className="text-sm font-medium">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Tuile KPI ; `delta` = variation relative vs période précédente, `invert` si une hausse est mauvaise. */
export function Kpi({ label, value, sub, delta, invert = false }: { label: string; value: string; sub?: string; delta?: number | null; invert?: boolean }) {
  const good = delta != null && (invert ? delta < 0 : delta > 0);
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <div className="truncate text-xs text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        {delta != null && Number.isFinite(delta) && (
          <span className={good ? "text-up" : delta === 0 ? "" : "text-down"}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "●"} {Math.abs(delta * 100).toFixed(0)} %
          </span>
        )}
        {sub && <span className="truncate">{sub}</span>}
      </div>
    </div>
  );
}

export const Grid = ({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 6 }) => {
  const c = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" }[cols];
  return <div className={`grid gap-3 ${c}`}>{children}</div>;
};

/** Barres horizontales HTML : la valeur est toujours écrite, la couleur ne porte pas seule le sens. */
export function BarList({ items, format = "number", total, colorVar = "--series-1" }: { items: { name: string; value: number; extra?: string }[]; format?: "number" | "percent"; total?: number; colorVar?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  if (!items.length) return <Empty />;
  return (
    <ul className="space-y-1.5">
      {items.map((i, idx) => (
        <li key={`${i.name}-${idx}`} className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${i.name} : ${format === "percent" ? pct(i.value) : fmt(i.value)}`}>
          <span className="truncate text-ink-2">{i.name}</span>
          <span className="h-2.5 rounded-full bg-grid/60">
            <span className="block h-full rounded-full transition-opacity group-hover:opacity-80" style={{ width: `${(i.value / max) * 100}%`, background: `var(${colorVar})` }} />
          </span>
          <span className="tnum w-24 text-right">
            {format === "percent" ? pct(i.value, 0) : fmt(i.value)}
            {total ? <span className="ml-1 text-xs text-muted">{pct(i.value / total, 0)}</span> : null}
            {i.extra && <span className="ml-1 text-xs text-muted">{i.extra}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const STATUS: Record<string, { color: string; icon: string }> = {
  actif: { color: "var(--good)", icon: "●" },
  "à risque": { color: "var(--warning)", icon: "▲" },
  parti: { color: "var(--critical)", icon: "✕" },
  "jamais actif": { color: "var(--muted)", icon: "○" },
};

export function StatusTag({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS["jamais actif"];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-ink-2">
      <span style={{ color: s.color }} aria-hidden>{s.icon}</span>
      {status}
    </span>
  );
}

/** Barre empilée 100 % des statuts utilisateurs. */
export function StatusBar({ items }: { items: { name: string; value: number }[] }) {
  const total = items.reduce((t, i) => t + i.value, 0) || 1;
  return (
    <div className="space-y-3">
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full">
        {items.filter((i) => i.value).map((i) => (
          <div key={i.name} title={`${i.name} : ${i.value}`} style={{ width: `${(i.value / total) * 100}%`, background: STATUS[i.name].color }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.name}>
            <StatusTag status={i.name} />
            <div className="text-lg font-semibold">
              {fmt(i.value)} <span className="text-xs font-normal text-muted">{pct(i.value / total, 0)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const seq = (v: number | null) => {
  if (v == null) return "transparent";
  const steps = [0, 0.05, 0.15, 0.3, 0.45, 0.6, 0.8];
  let i = 0;
  while (i < steps.length - 1 && v >= steps[i + 1]) i++;
  return `var(--seq-${i})`;
};

/** Tableau de cohortes : % de la cohorte actif la semaine k. */
export function CohortTable({ cohorts }: { cohorts: { week: string; size: number; weeks: (number | null)[] }[] }) {
  if (!cohorts.length) return <Empty />;
  const n = cohorts[0].weeks.length;
  return (
    <div className="overflow-x-auto">
      <table className="tnum w-full min-w-[560px] border-separate border-spacing-[2px] text-xs">
        <thead>
          <tr className="text-muted">
            <th className="text-left font-normal">Semaine d&apos;inscription</th>
            <th className="font-normal">Inscrits</th>
            {Array.from({ length: n }, (_, k) => <th key={k} className="font-normal">S{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.week}>
              <td className="whitespace-nowrap pr-2 text-ink-2">{frDate(c.week, { day: "numeric", month: "short", year: "2-digit" })}</td>
              <td className="text-center">{c.size}</td>
              {c.weeks.map((v, k) => (
                <td key={k} title={v == null ? "pas encore" : `${pct(v)} de ${c.size}`} className="h-7 rounded text-center"
                  style={{ background: seq(v), color: v != null && v >= 0.3 ? "#fff" : "var(--ink-2)" }}>
                  {v == null ? "" : `${Math.round(v * 100)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Heatmap({ rows, labels }: { rows: number[][]; labels: string[] }) {
  const max = Math.max(...rows.flat(), 1);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-[3rem_repeat(24,1fr)] gap-[2px] text-[10px] text-muted">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? `${h}h` : ""}</span>)}
        {rows.map((r, d) => (
          <div key={d} className="contents">
            <span className="pr-1 text-right leading-5">{labels[d]}</span>
            {r.map((v, h) => (
              <span key={h} title={`${labels[d]} ${h}h : ${v} séance(s)`} className="h-5 rounded-sm" style={{ background: v ? seq(0.05 + (v / max) * 0.8) : "var(--seq-0)" }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export const Empty = ({ text = "Pas encore de données." }: { text?: string }) => <p className="py-6 text-center text-sm text-muted">{text}</p>;

export function Stars({ n }: { n: number }) {
  return <span className="tracking-tight" aria-label={`${n} étoiles`}>{"★".repeat(n)}<span className="text-grid">{"★".repeat(5 - n)}</span></span>;
}
