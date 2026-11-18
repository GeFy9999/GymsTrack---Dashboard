import { BarTimeChart } from "@/components/charts";
import { BarList, Card, Empty, Grid, Kpi, Section } from "@/components/ui";
import { daysBetween, fmt, pct, ratio } from "@/lib/format";
import type { RevenueCatStats, StripeStats } from "@/lib/money";

type Source<T> = { data: T | null; error: string | null; enabled: boolean };

const money = (n: number | null | undefined, currency: string) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("fr-CA", { style: "currency", currency, maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n);

const delta = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);

function NotConnected({ what, env }: { what: string; env: string }) {
  return (
    <Card>
      <p className="text-sm text-ink-2">
        {what} n&apos;est pas connecté. Ajoute <code>{env}</code> dans <code>.env.local</code> (voir README).
      </p>
    </Card>
  );
}

export default function MoneySection({
  stripe, revenueCat, from, prevFrom, now, rangeLabel, weekly,
}: {
  stripe: Source<StripeStats>;
  revenueCat: Source<RevenueCatStats>;
  from: string;
  prevFrom: string;
  now: string;
  rangeLabel: string;
  weekly: boolean;
}) {
  return (
    <Section id="argent" title="Argent" subtitle="Chiffres réels de Stripe (abonnements web) et RevenueCat (abonnements Google Play)">
      {/* ── Stripe ─────────────────────────────────────────── */}
      <h3 className="pt-2 text-sm font-semibold text-ink-2">Web — Stripe</h3>
      {!stripe.enabled ? (
        <NotConnected what="Stripe" env="STRIPE_READONLY_KEY" />
      ) : stripe.error || !stripe.data ? (
        <Card><p className="text-sm text-down">{stripe.error}</p></Card>
      ) : (
        <StripeBlock s={stripe.data} from={from} prevFrom={prevFrom} now={now} rangeLabel={rangeLabel} weekly={weekly} />
      )}

      {/* ── RevenueCat ─────────────────────────────────────── */}
      <h3 className="pt-4 text-sm font-semibold text-ink-2">Android — Google Play via RevenueCat</h3>
      {!revenueCat.enabled ? (
        <NotConnected what="RevenueCat" env="REVENUECAT_API_KEY et REVENUECAT_PROJECT_ID" />
      ) : revenueCat.error || !revenueCat.data ? (
        <Card><p className="text-sm text-down">{revenueCat.error}</p></Card>
      ) : (
        <RevenueCatBlock rc={revenueCat.data} />
      )}
    </Section>
  );
}

function StripeBlock({ s, from, prevFrom, now, rangeLabel, weekly }: { s: StripeStats; from: string; prevFrom: string; now: string; rangeLabel: string; weekly: boolean }) {
  const inRange = (d: string | null, a = from, b = now) => d != null && d >= a && d <= b;
  const days = s.daily.filter((d) => inRange(d.date));
  const prevDays = s.daily.filter((d) => inRange(d.date, prevFrom, from));
  const gross = days.reduce((t, d) => t + d.gross, 0);
  const refunded = days.reduce((t, d) => t + d.refunded, 0);
  const net = gross - refunded;
  const netPrev = prevDays.reduce((t, d) => t + d.net, 0);
  const payments = days.reduce((t, d) => t + d.count, 0);
  const newSubs = s.subEvents.filter((e) => inRange(e.created)).length;
  const canceled = s.subEvents.filter((e) => inRange(e.canceled)).length;
  const lifetime = s.oneTime.filter((o) => inRange(o.date));
  const failed = s.failed.filter((d) => inRange(d)).length;
  // Abonnés au début de la période, pour un taux d'annulation approximatif.
  const activeAtStart = s.subEvents.filter((e) => e.created < from && (!e.canceled || e.canceled >= from)).length;

  // Série journalière complète (jours sans paiement = 0), regroupée par semaine au-delà de 90 j.
  const byDay = new Map(days.map((d) => [d.date, d]));
  let series = daysBetween(from, now).map((date) => ({ date, net: byDay.get(date)?.net ?? 0, refunded: byDay.get(date)?.refunded ?? 0 }));
  if (weekly) {
    const weeks = new Map<string, { date: string; net: number; refunded: number }>();
    for (const d of series) {
      const dt = new Date(d.date + "T00:00:00Z");
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      const w = dt.toISOString().slice(0, 10);
      const b = weeks.get(w) ?? { date: w, net: 0, refunded: 0 };
      b.net += d.net;
      b.refunded += d.refunded;
      weeks.set(w, b);
    }
    series = [...weeks.values()];
  }

  const c = s.currency;
  return (
    <>
      <Grid cols={6}>
        <Kpi label="MRR (revenu mensuel récurrent)" value={money(s.mrr, c)} sub={`ARR ${money(s.arr, c)}`} />
        <Kpi label={`Encaissé net (${rangeLabel})`} value={money(net, c)} delta={delta(net, netPrev)} sub={`${fmt(payments)} paiement(s) · ${money(refunded, c)} remboursé`} />
        <Kpi label="Abonnés payants" value={fmt(s.active)} sub={`${fmt(s.trialing)} en essai`} />
        <Kpi label="Revenu moyen / abonné" value={money(s.arpu, c)} sub="par mois" />
        <Kpi label="Nouveaux / annulés" value={`+${fmt(newSubs)} / −${fmt(canceled)}`} sub={`churn ${pct(ratio(canceled, activeAtStart), 0)} sur ${rangeLabel}`} />
        <Kpi label="Solde Stripe" value={money(s.balance.available, c)} sub={`${money(s.balance.pending, c)} en attente`} />
      </Grid>
      <Grid cols={3}>
        <Card title="Encaissé par jour" hint="paiements nets des remboursements" className="lg:col-span-2">
          <BarTimeChart data={series} series={[{ key: "net", label: `Net (${c})`, color: 1 }, { key: "refunded", label: "Remboursé", color: 2 }]} />
        </Card>
        <Card title="À surveiller">
          <BarList
            items={[
              { name: "Annulation prévue", value: s.cancelScheduled },
              { name: "Paiement en retard", value: s.pastDue },
              { name: `Paiements échoués (${rangeLabel})`, value: failed },
              { name: `Achats à vie (${rangeLabel})`, value: lifetime.length },
            ]}
            colorVar="--series-2"
          />
          <p className="mt-3 text-xs text-muted">Formules des abonnés payants :</p>
          {s.planMix.length ? <BarList items={s.planMix} total={s.active} /> : <Empty text="Aucun abonné payant." />}
        </Card>
      </Grid>
      {s.otherCurrencies.length > 0 && (
        <p className="text-xs text-muted">
          Montants en {c}. Paiements dans d&apos;autres devises non additionnés : {s.otherCurrencies.join(", ")}.
        </p>
      )}
    </>
  );
}

function RevenueCatBlock({ rc }: { rc: RevenueCatStats }) {
  const m = (id: string) => rc.metrics[id]?.value ?? null;
  const c = rc.currency;
  return (
    <>
      <Grid cols={6}>
        <Kpi label="MRR" value={money(m("mrr"), c)} />
        <Kpi label="Revenus (28 j)" value={money(m("revenue"), c)} />
        <Kpi label="Abonnements actifs" value={fmt(m("active_subscriptions"))} />
        <Kpi label="Essais en cours" value={fmt(m("active_trials"))} />
        <Kpi label="Nouveaux clients (28 j)" value={fmt(m("new_customers"))} sub="ont ouvert l'app Android" />
        <Kpi label="Utilisateurs actifs (28 j)" value={fmt(m("active_users"))} />
      </Grid>
      <p className="text-xs text-muted">
        Résumé fourni par RevenueCat (périodes fixes, en {c}). Les graphiques détaillés sont dans l&apos;onglet Charts de RevenueCat.
      </p>
    </>
  );
}
