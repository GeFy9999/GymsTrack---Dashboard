"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export type ValueFormat = "number" | "percent" | "rating" | "decimal";
export type Series = { key: string; label: string; color: number };

const nf = new Intl.NumberFormat("fr-FR");
const fmtValue = (v: unknown, f: ValueFormat = "number") => {
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (f === "percent") return `${(v * 100).toFixed(v < 0.1 ? 2 : 1).replace(".", ",")} %`;
  if (f === "rating") return v.toFixed(2).replace(".", ",") + " ★";
  if (f === "decimal") return v.toFixed(1).replace(".", ",");
  return nf.format(Math.round(v));
};
const fmtAxis = (v: number, f: ValueFormat) =>
  f === "percent" ? `${Math.round(v * 100)} %` : f === "rating" ? v.toFixed(1) : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)} k` : String(v);
const fmtDate = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
const color = (i: number) => `var(--series-${i})`;

const axisProps = { stroke: "var(--axis)", tickLine: false, tickMargin: 6 } as const;

function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; format: ValueFormat }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{fmtDate(String(label))}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="tnum ml-auto pl-4 font-medium text-ink">{fmtValue(p.value, format)}</span>
        </div>
      ))}
    </div>
  );
}

const legend = <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--ink-2)", paddingTop: 4 }} />;

export function TimeChart({
  data, series, format = "number", height = 240, area = false, refLine, yDomain,
}: {
  data: Record<string, unknown>[]; series: Series[]; format?: ValueFormat; height?: number; area?: boolean;
  refLine?: { y: number; label: string }; yDomain?: [number | "auto", number | "auto"];
}) {
  const Chart = area ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={32} {...axisProps} />
        <YAxis tickFormatter={(v) => fmtAxis(v, format)} width={48} axisLine={false} domain={yDomain} {...axisProps} />
        <Tooltip content={<ChartTooltip format={format} />} />
        {series.length > 1 && legend}
        {refLine && (
          <ReferenceLine y={refLine.y} stroke="var(--critical)" strokeDasharray="4 4"
            label={{ value: refLine.label, position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }} />
        )}
        {series.map((s) =>
          area ? (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(s.color)} fill={color(s.color)}
              fillOpacity={0.12} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls />
          ) : (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(s.color)} strokeWidth={2}
              dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

export function BarTimeChart({
  data, series, stacked = false, format = "number", height = 240, xKey = "date",
}: { data: Record<string, unknown>[]; series: Series[]; stacked?: boolean; format?: ValueFormat; height?: number; xKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={xKey} tickFormatter={fmtDate} minTickGap={24} {...axisProps} />
        <YAxis tickFormatter={(v) => fmtAxis(v, format)} width={48} axisLine={false} {...axisProps} />
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: "var(--grid)", opacity: 0.5 }} />
        {series.length > 1 && legend}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={color(s.color)} stackId={stacked ? "a" : undefined}
            stroke={stacked ? "var(--surface)" : undefined} strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
