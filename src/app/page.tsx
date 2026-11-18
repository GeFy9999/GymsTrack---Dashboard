import Link from "next/link";
import { BarTimeChart, TimeChart } from "@/components/charts";
import { BarList, Card, CohortTable, Empty, Grid, Heatmap, Kpi, Section, Stars, StatusBar, StatusTag } from "@/components/ui";
import { getAppStats } from "@/lib/app-db";
import { addDays, fmt, fmt1, frDate, pct, ratio, today, weight } from "@/lib/format";
import { aggregateBreakdown, clearPlayCache, getPlayData } from "@/lib/play";
import MoneySection from "@/components/MoneySection";
import { clearMoneyCache, getRevenueCatStats, getStripeStats, revenueCatConfigured, settle, stripeConfigured } from "@/lib/money";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "7", label: "7 j" },
  { key: "30", label: "30 j" },
  { key: "90", label: "90 j" },
  { key: "365", label: "1 an" },
];

const NAV = [
  ["apercu", "Aperçu"], ["play", "Play Store"], ["acquisition", "Acquisition"], ["retention", "Rétention"],
  ["engagement", "Engagement"], ["users", "Utilisateurs"], ["revenus", "Pro"], ["argent", "Argent"], ["qualite", "Qualité"], ["avis", "Avis"],
] as const;

type Num = Record<string, number | string | null>;

/** Regroupe par semaine (lundi) au-delà de 90 jours pour garder des graphiques lisibles. */
function bucket<T extends Num>(rows: T[], rangeDays: number, sumKeys: string[], lastKeys: string[] = []): Num[] {
  if (rangeDays <= 90) return rows;
  const out = new Map<string, Num>();
  for (const r of rows) {
    const d = new Date(String(r.date) + "T00:00:00Z");
    const week = addDays(String(r.date), -((d.getUTCDay() + 6) % 7));
    const b = out.get(week) ?? { date: week };
    for (const k of sumKeys) b[k] = (Number(b[k]) || 0) + (Number(r[k]) || 0);
    for (const k of lastKeys) if (r[k] != null) b[k] = r[k];
    out.set(week, b);
  }
  return [...out.values()];
}

const delta = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string; refresh?: string }> }) {
  const sp = await searchParams;
  const range = RANGES.some((r) => r.key === sp.range) ? Number(sp.range) : 30;
  if (sp.refresh) {
    clearPlayCache();
    clearMoneyCache();
  }

  const now = today();
  const from = addDays(now, -range + 1);
  const prevFrom = addDays(from, -range);
  const [play, stripe, revenueCat] = await Promise.all([
    getPlayData(),
    settle(stripeConfigured(), getStripeStats),
    settle(revenueCatConfigured(), getRevenueCatStats),
  ]);

  let app: ReturnType<typeof getAppStats> | null = null;
  let appError: string | null = null;
  try {
    app = getAppStats(range);
  } catch (e) {
    appError = (e as Error).message;
  }

  // ── Play : installations ───────────────────────────────────────────────
  const inst = play.installs.filter((r) => r.date >= from);
  const instPrev = play.installs.filter((r) => r.date >= prevFrom && r.date < from);
  const installs = sum(inst, (r) => r.installs);
  const uninstalls = sum(inst, (r) => r.uninstalls);
  const installsPrev = sum(instPrev, (r) => r.installs);
  const uninstallsPrev = sum(instPrev, (r) => r.uninstalls);
  const userInstalls = sum(inst, (r) => r.userInstalls);
  // Google laisse parfois ces colonnes vides les derniers jours : on prend la dernière valeur connue.
  const lastKnown = (rows: typeof inst, key: "activeDevices" | "totalUserInstalls") => [...rows].reverse().find((r) => r[key] > 0)?.[key] ?? 0;
  const activeDevices = lastKnown(play.installs, "activeDevices");
  const activeDevicesStart = inst.find((r) => r.activeDevices > 0)?.activeDevices ?? 0;
  // « Total User Installs » est souvent vide : à défaut, somme des nouveaux utilisateurs jour par jour.
  const totalUserInstalls = Math.max(0, ...play.installs.map((r) => r.totalUserInstalls)) || sum(play.installs, (r) => r.userInstalls);

  // ── Play : acquisition & rétention des installeurs ─────────────────────
  const acq = play.acquisition.filter((r) => r.date >= from);
  const visitors = sum(acq, (r) => r.visitors);
  const installers = sum(acq, (r) => r.installers);
  const installerRetention = [1, 7, 15, 30].map((n) => {
    const eligible = play.acquisition.filter((r) => r.date >= addDays(from, -n) && r.date <= addDays(now, -n) && r.retained[n] != null);
    return { name: `J${n}`, value: ratio(sum(eligible, (r) => r.retained[n] ?? 0), sum(eligible, (r) => r.installers)) };
  });
  const channels = Object.values(
    acq.reduce<Record<string, { name: string; visitors: number; installers: number }>>((m, r) => {
      const c = (m[r.channel] ??= { name: r.channel, visitors: 0, installers: 0 });
      c.visitors += r.visitors;
      c.installers += r.installers;
      return m;
    }, {}),
  ).sort((a, b) => b.installers - a.installers);
  const acqDaily = Object.values(
    acq.reduce<Record<string, { date: string; visitors: number; installers: number }>>((m, r) => {
      const d = (m[r.date] ??= { date: r.date, visitors: 0, installers: 0 });
      d.visitors += r.visitors;
      d.installers += r.installers;
      return m;
    }, {}),
  ).sort((a, b) => a.date.localeCompare(b.date));

  // ── Play : qualité ─────────────────────────────────────────────────────
  const ratingNow = play.ratings.at(-1)?.total ?? null;
  const ratingStart = play.ratings.filter((r) => r.date >= from)[0]?.total ?? null;
  const vit = play.vitals.filter((r) => r.date >= from);
  const avgOf = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const crashRate = avgOf(vit.map((v) => v.crashRate));
  const anrRate = avgOf(vit.map((v) => v.anrRate));
  const crashes = play.crashes.filter((r) => r.date >= from);
  const reviews = play.reviews.filter((r) => r.date >= from);
  const starDist = [5, 4, 3, 2, 1].map((s) => ({ name: `${s} ★`, value: reviews.filter((r) => r.stars === s).length }));

  const rangeLabel = RANGES.find((r) => Number(r.key) === range)!.label;
  const vsPrev = `vs ${rangeLabel} précédents`;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
      {/* En-tête collant : période + navigation */}
      <header className="sticky top-0 z-10 -mx-4 border-b border-line bg-page px-4 py-3 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold">GymTrack · Stats</h1>
          <span className={`rounded-full border border-line px-2 py-0.5 text-xs ${play.source === "live" ? "text-up" : "text-ink-2"}`}>
            Play Store : {play.source === "live" ? "● en direct" : "○ démo"}
          </span>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5 text-sm">
            {RANGES.map((r) => (
              <Link key={r.key} href={`?range=${r.key}`} className={`rounded-md px-2.5 py-1 ${Number(r.key) === range ? "bg-ink text-page" : "text-ink-2 hover:bg-grid/50"}`}>
                {r.label}
              </Link>
            ))}
          </div>
          <Link href={`?range=${range}&refresh=1`} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-sm text-ink-2 hover:bg-grid/50" title="Recharger les rapports Play Console">↻</Link>
        </div>
        <nav className="mt-2 flex gap-4 overflow-x-auto text-sm text-ink-2">
          {NAV.map(([id, label]) => <a key={id} href={`#${id}`} className="whitespace-nowrap hover:text-ink">{label}</a>)}
        </nav>
      </header>

      {play.error && <div className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-down">{play.error}</div>}
      {play.source === "demo" && !play.error && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-ink-2">
          Les chiffres <b>Play Store</b> (installations, acquisition, notes, crashs, avis) sont des <b>données de démo</b>. Remplis <code>.env.local</code> (voir README) pour brancher ta Play Console.
          Les stats <b>utilisateurs / rétention / engagement / revenus</b> viennent de ta vraie base GymTrack.
        </div>
      )}

      {/* ── Aperçu ─────────────────────────────────────────────────────── */}
      <Section id="apercu" title="Aperçu" subtitle={`${rangeLabel} · du ${frDate(from)} au ${frDate(now)}`}>
        <Grid cols={4}>
          <Kpi label="Installations Play" value={fmt(installs)} delta={delta(installs, installsPrev)} sub={vsPrev} />
          <Kpi label="Appareils avec l'app installée" value={fmt(activeDevices)} delta={delta(activeDevices, activeDevicesStart)} sub="vs début de période" />
          <Kpi label="Utilisateurs (comptes)" value={fmt(app?.total)} sub={app ? `+${fmt(app.range.newUsers)} sur ${rangeLabel}` : undefined} delta={app ? delta(app.range.newUsers, app.range.newUsersPrev) : null} />
          <Kpi label="Actifs 30 j (MAU)" value={fmt(app?.mau)} sub={app ? `DAU ${fmt(app.dau)} · WAU ${fmt(app.wau)}` : undefined} />
          <Kpi label="Rétention J7" value={pct(app?.retention[7]?.rate)} sub={app?.retention[7] ? `sur ${app.retention[7].base} inscrits` : undefined} />
          <Kpi label="Rétention J30" value={pct(app?.retention[30]?.rate)} sub={app?.retention[30] ? `sur ${app.retention[30].base} inscrits` : undefined} />
          <Kpi label="Utilisateurs Pro" value={fmt(app?.monetization.pro)} sub={`conversion ${pct(app?.monetization.conversion)}`} />
          <Kpi label="Note Play Store" value={ratingNow ? `${fmt1(ratingNow)} ★` : "—"} delta={ratingNow && ratingStart ? (ratingNow - ratingStart) / ratingStart : null} sub="moyenne globale" />
        </Grid>
        <Grid cols={2}>
          <Card title="Entonnoir" hint={`${rangeLabel} · fiche Play → installation → compte → 1re séance → Pro`}>
            <BarList
              items={[
                { name: "Visiteurs fiche", value: visitors },
                { name: "Installeurs", value: installers || userInstalls, extra: pct(ratio(installers, visitors), 0) },
                { name: "Comptes créés", value: app?.range.newUsers ?? 0, extra: pct(ratio(app?.range.newUsers ?? 0, installers || userInstalls), 0) },
                { name: "1re séance faite", value: app?.range.newActivated ?? 0, extra: pct(ratio(app?.range.newActivated ?? 0, app?.range.newUsers ?? 0), 0) },
                { name: "Passés Pro", value: app?.range.newPro ?? 0, extra: pct(ratio(app?.range.newPro ?? 0, app?.range.newUsers ?? 0), 0) },
              ]}
            />
            <p className="mt-3 text-xs text-muted">Le % à droite = conversion depuis l&apos;étape précédente.</p>
          </Card>
          <Card title="Qui reste, qui part" hint={`actif ≤ 7 j · à risque 8–21 j · parti > 21 j sans séance ni pesée`}>
            {app ? <StatusBar items={app.statusList} /> : <Empty text={appError ?? undefined} />}
          </Card>
        </Grid>
      </Section>

      {/* ── Play Store ─────────────────────────────────────────────────── */}
      <Section id="play" title="Play Store — installations" subtitle="Rapports Play Console (statistiques d'installation)">
        <Grid cols={6}>
          <Kpi label="Installations" value={fmt(installs)} delta={delta(installs, installsPrev)} />
          <Kpi label="Désinstallations" value={fmt(uninstalls)} delta={delta(uninstalls, uninstallsPrev)} invert />
          <Kpi label="Gain net" value={fmt(installs - uninstalls)} />
          <Kpi label="Taux de désinstall." value={pct(ratio(uninstalls, installs), 0)} sub="désinstall. / install." />
          <Kpi label="Nouveaux utilisateurs" value={fmt(userInstalls)} sub="installs uniques" />
          <Kpi label="Utilisateurs cumulés" value={fmt(totalUserInstalls)} sub="depuis le lancement" />
        </Grid>
        <Grid cols={2}>
          <Card title="Installations vs désinstallations">
            <BarTimeChart data={bucket(inst, range, ["installs", "uninstalls"])} series={[{ key: "installs", label: "Installations", color: 1 }, { key: "uninstalls", label: "Désinstallations", color: 2 }]} />
          </Card>
          <Card title="Appareils avec l'app installée">
            <TimeChart area data={bucket(inst, range, [], ["activeDevices"])} series={[{ key: "activeDevices", label: "Appareils actifs", color: 1 }]} />
          </Card>
        </Grid>
        <Grid cols={3}>
          {([["Pays", play.byCountry], ["Appareils", play.byDevice], ["Version d'Android", play.byOs], ["Version de l'app", play.byAppVersion], ["Langue", play.byLanguage]] as const).map(([title, rows]) => {
            const agg = aggregateBreakdown(rows, from, 8);
            return (
              <Card key={title} title={title} hint={`installations sur ${rangeLabel} · % du total · désinstall.`}>
                <BarList items={agg.map((b) => ({ name: b.name, value: b.installs, extra: `−${fmt(b.uninstalls)}` }))} total={sum(agg, (b) => b.installs)} />
              </Card>
            );
          })}
          <Card title="Mises à jour" hint="installations d'une nouvelle version">
            <BarTimeChart height={200} data={bucket(inst, range, ["upgrades"])} series={[{ key: "upgrades", label: "Mises à jour", color: 3 }]} />
          </Card>
        </Grid>
      </Section>

      {/* ── Acquisition ────────────────────────────────────────────────── */}
      <Section id="acquisition" title="Acquisition — fiche Play Store" subtitle="Visiteurs de ta fiche, conversion et rétention des installeurs (données Google)">
        <Grid cols={6}>
          <Kpi label="Visiteurs de la fiche" value={fmt(visitors)} />
          <Kpi label="Installeurs" value={fmt(installers)} />
          <Kpi label="Conversion fiche" value={pct(ratio(installers, visitors))} sub="visiteurs → installeurs" />
          {installerRetention.slice(1).map((r) => (
            <Kpi key={r.name} label={`Installeurs gardés ${r.name}`} value={pct(r.value, 0)} sub={r.value == null ? "non fourni par Google" : "app toujours installée"} />
          ))}
        </Grid>
        <Grid cols={2}>
          <Card title="Visiteurs et installeurs">
            <TimeChart data={bucket(acqDaily, range, ["visitors", "installers"])} series={[{ key: "visitors", label: "Visiteurs", color: 1 }, { key: "installers", label: "Installeurs", color: 2 }]} />
          </Card>
          <Card title="Canaux d'acquisition" hint="installeurs · taux de conversion du canal">
            <BarList items={channels.map((c) => ({ name: c.name, value: c.installers, extra: pct(ratio(c.installers, c.visitors), 0) }))} total={installers} />
          </Card>
        </Grid>
      </Section>

      {app ? (
        <>
          {/* ── Rétention ─────────────────────────────────────────────── */}
          <Section id="retention" title="Rétention & churn" subtitle="Calculée sur ta base : un utilisateur est « revenu au jour N » s'il a fait une séance ou une pesée ≥ N jours après l'inscription">
            <Grid cols={6}>
              {[1, 7, 14, 30, 60, 90].map((n) => (
                <Kpi key={n} label={`Rétention J${n}`} value={pct(app.retention[n]?.rate, 0)} sub={app.retention[n] ? `base ${app.retention[n].base}` : "pas assez de recul"} />
              ))}
            </Grid>
            <Grid cols={2}>
              <Card title="Courbe de rétention" hint="% des inscrits encore actifs après N jours">
                <TimeChart format="percent" yDomain={[0, 1]}
                  data={app.retentionCurve.map((p) => ({ date: `J${p.day}`, rate: p.rate }))}
                  series={[{ key: "rate", label: "Rétention", color: 1 }]} />
              </Card>
              <Card title="Activation" hint="ce que font les nouveaux inscrits">
                <BarList total={app.total} items={[
                  { name: "≥ 1 séance", value: app.activation.atLeast1 },
                  { name: "≥ 3 séances", value: app.activation.atLeast3 },
                  { name: "≥ 10 séances", value: app.activation.atLeast10 },
                  { name: "1re séance < 24 h", value: app.activation.sameDay },
                ]} />
                <p className="mt-3 text-xs text-muted">
                  Délai médian avant la 1re séance : <b className="text-ink">{app.activation.medianHoursToFirst == null ? "—" : app.activation.medianHoursToFirst < 48 ? `${fmt1(app.activation.medianHoursToFirst)} h` : `${fmt1(app.activation.medianHoursToFirst / 24)} j`}</b>
                </p>
              </Card>
            </Grid>
            <Card title="Cohortes hebdomadaires" hint="% de chaque cohorte d'inscrits actif la semaine S0, S1, S2…">
              <CohortTable cohorts={app.cohorts} />
            </Card>
            <Card title="Partis récemment" hint="utilisateurs avec ≥ 3 séances, inactifs depuis plus de 21 jours — à relancer ?">
              <UserTable users={app.churnRecent} />
            </Card>
          </Section>

          {/* ── Engagement ────────────────────────────────────────────── */}
          <Section id="engagement" title="Engagement" subtitle={`Utilisation réelle de l'app sur ${rangeLabel}`}>
            <Grid cols={6}>
              <Kpi label="Séances" value={fmt(app.range.sessions)} delta={delta(app.range.sessions, app.range.sessionsPrev)} sub={vsPrev} />
              <Kpi label="Séances terminées" value={pct(app.range.completionRate, 0)} />
              <Kpi label="Durée moyenne" value={app.range.avgDuration ? `${fmt(app.range.avgDuration)} min` : "—"} sub={app.range.medianDuration ? `médiane ${fmt(app.range.medianDuration)} min` : undefined} />
              <Kpi label="Séances / actif / sem." value={fmt1(app.range.sessionsPerActiveUserWeek)} sub={`${fmt(app.range.activeUsers)} utilisateurs actifs`} />
              <Kpi label="Séries validées" value={fmt(app.range.sets)} sub={`${fmt(app.range.reps)} répétitions`} />
              <Kpi label="Volume soulevé" value={weight(app.range.volumeKg)} sub="poids × reps" />
            </Grid>
            <Grid cols={2}>
              <Card title="Utilisateurs actifs" hint={`DAU / WAU / MAU · stickiness DAU/MAU ${pct(app.stickiness, 0)}`}>
                <TimeChart data={app.daily} series={[{ key: "mau", label: "MAU (30 j)", color: 1 }, { key: "wau", label: "WAU (7 j)", color: 2 }, { key: "dau", label: "DAU", color: 3 }]} />
              </Card>
              <Card title="Séances par jour">
                <BarTimeChart stacked data={bucket(app.daily.map((d) => ({ ...d, open: d.sessions - d.completed })), range, ["completed", "open"])}
                  series={[{ key: "completed", label: "Terminées", color: 1 }, { key: "open", label: "Non terminées", color: 2 }]} />
              </Card>
            </Grid>
            <Card title="Quand s'entraînent-ils ?" hint={`séances par jour et heure (${app.tz})`}>
              <Heatmap rows={app.heat} labels={app.weekdays} />
            </Card>
            <Grid cols={3}>
              <Card title="Groupes musculaires" hint="séances par groupe">
                <BarList items={app.muscle.slice(0, 10)} total={app.range.sessions} />
              </Card>
              <Card title="Séances par utilisateur" hint="nombre d'utilisateurs par total de séances (depuis toujours)">
                <BarList items={app.sessionHistogram} total={app.total} />
              </Card>
              <Card title="Adoption des fonctionnalités" hint="% des utilisateurs qui l'ont utilisée">
                <BarList items={app.featureAdoption} format="percent" colorVar="--series-3" />
              </Card>
            </Grid>
          </Section>

          {/* ── Utilisateurs ──────────────────────────────────────────── */}
          <Section id="users" title="Utilisateurs" subtitle="Inscriptions et profils">
            <Grid cols={2}>
              <Card title="Inscriptions">
                <BarTimeChart data={bucket(app.daily, range, ["signups"])} series={[{ key: "signups", label: "Inscriptions", color: 1 }]} />
              </Card>
              <Card title="Total des comptes">
                <TimeChart area data={bucket(app.daily, range, [], ["totalUsers"])} series={[{ key: "totalUsers", label: "Comptes", color: 1 }]} />
              </Card>
            </Grid>
            <Grid cols={3}>
              <Card title="Connexion"><BarList items={app.breakdowns.auth} total={app.total} /></Card>
              <Card title="Langue de l'app"><BarList items={app.breakdowns.language} total={app.total} /></Card>
              <Card title="Unité de poids"><BarList items={app.breakdowns.unit} total={app.total} /></Card>
            </Grid>
            <Card title="Derniers inscrits"><UserTable users={app.recentUsers} /></Card>
            <Card title="Les plus assidus"><UserTable users={app.topUsers} /></Card>
          </Section>

          {/* ── Revenus ───────────────────────────────────────────────── */}
          <Section id="revenus" title="Abonnés Pro" subtitle="Statut Pro enregistré dans ta base (web et Android confondus)">
            <Grid cols={6}>
              <Kpi label="Pro actifs" value={fmt(app.monetization.pro)} />
              <Kpi label="Conversion globale" value={pct(app.monetization.conversion)} sub="Pro / comptes" />
              <Kpi label="Conversion des actifs" value={pct(app.monetization.conversionActive)} sub="Pro / ≥ 1 séance" />
              <Kpi label="Essais utilisés" value={fmt(app.monetization.trials)} />
              <Kpi label="Anciens Pro" value={fmt(app.monetization.exPro)} sub="abonnement terminé" />
              <Kpi label="Pro encore actifs" value={pct(app.monetization.proRetention, 0)} sub={`vs ${pct(app.monetization.freeRetention, 0)} chez les gratuits`} />
            </Grid>
            <Grid cols={2}>
              <Card title="Formule"><BarList items={app.monetization.byInterval} total={app.monetization.pro} /></Card>
              <Card title="Plateforme de paiement"><BarList items={app.monetization.byProvider} total={app.monetization.pro} /></Card>
            </Grid>
          </Section>
        </>
      ) : (
        <Section id="retention" title="Données de l'app">
          <Card><Empty text={appError ?? "Base indisponible"} /></Card>
        </Section>
      )}

      <MoneySection stripe={stripe} revenueCat={revenueCat} from={from} prevFrom={prevFrom} now={now} rangeLabel={rangeLabel} weekly={range > 90} />

      {/* ── Qualité ──────────────────────────────────────────────────── */}
      <Section id="qualite" title="Qualité" subtitle="Notes, crashs et ANR (Android vitals)">
        <Grid cols={4}>
          <Kpi label="Note moyenne" value={ratingNow ? `${fmt1(ratingNow)} ★` : "—"} />
          <Kpi label="Taux de crash perçu" value={pct(crashRate, 2)} sub="seuil Google : 1,09 %" />
          <Kpi label="Taux d'ANR perçu" value={pct(anrRate, 2)} sub="seuil Google : 0,47 %" />
          <Kpi label="Crashs" value={fmt(sum(crashes, (c) => c.crashes))} sub={`${fmt(sum(crashes, (c) => c.anrs))} ANR`} />
        </Grid>
        <Grid cols={2}>
          <Card title="Note moyenne globale">
            <TimeChart format="rating" yDomain={[1, 5]} data={bucket(play.ratings.filter((r) => r.date >= from), range, [], ["total"])} series={[{ key: "total", label: "Note", color: 4 }]} />
          </Card>
          <Card title="Taux de crash perçu par les utilisateurs">
            {vit.length ? (
              <TimeChart format="percent" data={vit} refLine={{ y: 0.0109, label: "seuil 1,09 %" }} series={[{ key: "crashRate", label: "Crash", color: 1 }]} />
            ) : <Empty text={play.source === "live" ? "Pas encore de données : Google ne publie les vitals qu'à partir d'un nombre minimum d'utilisateurs par jour." : "Vitals indisponibles."} />}
          </Card>
          <Card title="Taux d'ANR perçu">
            {vit.length ? (
              <TimeChart format="percent" data={vit} refLine={{ y: 0.0047, label: "seuil 0,47 %" }} series={[{ key: "anrRate", label: "ANR", color: 2 }]} />
            ) : <Empty />}
          </Card>
          <Card title="Utilisateurs Android distincts / jour" hint="selon Android vitals">
            {vit.length ? <TimeChart area data={vit} series={[{ key: "distinctUsers", label: "Utilisateurs", color: 3 }]} /> : <Empty />}
          </Card>
        </Grid>
      </Section>

      {/* ── Avis ─────────────────────────────────────────────────────── */}
      <Section id="avis" title="Avis Play Store" subtitle={`${reviews.length} avis sur ${rangeLabel} · ${reviews.filter((r) => !r.replied).length} sans réponse`}>
        <Grid cols={3}>
          <Card title="Répartition des étoiles"><BarList items={starDist} total={reviews.length} colorVar="--series-4" /></Card>
          <Card title="Derniers avis" className="lg:col-span-2">
            {reviews.length ? (
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto pr-2">
                {reviews.slice(0, 40).map((r, i) => (
                  <li key={i} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                      <span className="text-sm text-[var(--series-4)]"><Stars n={r.stars} /></span>
                      <span>{frDate(r.date)}</span>
                      {r.version && <span>v{r.version}</span>}
                      {r.device && <span>{r.device}</span>}
                      <span>{r.lang}</span>
                      <span className={r.replied ? "text-up" : ""}>{r.replied ? "✓ répondu" : "pas de réponse"}</span>
                      {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="underline">répondre</a>}
                    </div>
                    {r.title && <div className="mt-1 font-medium">{r.title}</div>}
                    <p className="mt-0.5 text-ink-2">{r.text || <i>(note sans texte)</i>}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty />}
          </Card>
        </Grid>
      </Section>
    </div>
  );
}

type PublicUser = ReturnType<typeof getAppStats>["recentUsers"][number];

function UserTable({ users }: { users: PublicUser[] }) {
  if (!users.length) return <Empty text="Personne pour l'instant." />;
  const d = (iso: string | null) => frDate(iso, { day: "numeric", month: "short", year: "2-digit" });
  return (
    <div className="overflow-x-auto">
      <table className="tnum w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="pb-2 font-normal">Utilisateur</th><th className="pb-2 font-normal">Inscrit</th><th className="pb-2 font-normal">Dernière activité</th>
            <th className="pb-2 text-right font-normal">Séances</th><th className="pb-2 font-normal pl-4">Statut</th><th className="pb-2 font-normal">Compte</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="py-1.5 pr-3"><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></td>
              <td className="pr-3">{d(u.signup)}</td>
              <td className="pr-3">{d(u.last)}{u.idle != null && <span className="ml-1 text-xs text-muted">({u.idle} j)</span>}</td>
              <td className="text-right">{u.sessions}</td>
              <td className="pl-4"><StatusTag status={u.status} /></td>
              <td className="text-xs text-ink-2">{u.pro ? "★ Pro" : "Gratuit"} · {u.auth === "google" ? "Google" : "E-mail"} · {u.lang.toUpperCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
