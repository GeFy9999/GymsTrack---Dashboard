import "server-only";
import { google } from "googleapis";
import { decodeReport, num, numOrNull, parseCsv, str, type Row } from "./csv";
import { demoPlayData } from "./play-demo";
import type { Acquisition, Breakdown, BreakdownDaily, DailyVitals, PlayData, Review } from "./play-types";
import { addDays, today } from "./format";

const CACHE_MS = 30 * 60_000;
let cache: { at: number; months: number; data: PlayData } | null = null;

export function playConfigured() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return Boolean(process.env.PLAY_REPORTS_BUCKET && credentials && process.env.PLAY_PACKAGE_NAME);
}

/** Clé du compte de service : chemin d'un fichier (sur ton PC) ou contenu JSON / base64 (variable de la stack). */
function googleCredentials(): { keyFile: string } | { credentials: Record<string, string> } {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) return { keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE };
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!.trim();
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return { credentials: JSON.parse(json) };
}

/** Récupère les rapports Play Console des `months` derniers mois (cache 30 min). */
export async function getPlayData(months = 13): Promise<PlayData> {
  if (!playConfigured()) return demoPlayData();
  if (cache && Date.now() - cache.at < CACHE_MS && cache.months >= months) return cache.data;
  try {
    const data = await fetchLive(months);
    cache = { at: Date.now(), months, data };
    return data;
  } catch (e) {
    return { ...demoPlayData(), error: `Play Console inaccessible, données de démo affichées : ${(e as Error).message}` };
  }
}

export function clearPlayCache() {
  cache = null;
}

function monthKeys(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out.reverse();
}

async function fetchLive(months: number): Promise<PlayData> {
  const pkg = process.env.PLAY_PACKAGE_NAME!;
  const bucket = process.env.PLAY_REPORTS_BUCKET!.replace(/^gs:\/\//, "").split("/")[0];
  const auth = new google.auth.GoogleAuth({
    ...googleCredentials(),
    scopes: [
      "https://www.googleapis.com/auth/devstorage.read_only",
      "https://www.googleapis.com/auth/playdeveloperreporting",
    ],
  });
  const storage = google.storage({ version: "v1", auth });

  // Liste réelle des fichiers du bucket → on ne télécharge que ce qui existe.
  // L'accès au bucket arrive parfois des heures après l'API vitals : dans ce
  // cas on affiche quand même les vitals réels plutôt que de la démo.
  const existing = new Set<string>();
  let reportsError: string | null = null;
  try {
    for (const prefix of ["stats/installs/", "stats/ratings/", "stats/crashes/", "acquisition/retained_installers/", "stats/store_performance/", "reviews/"]) {
      let pageToken: string | undefined;
      do {
        const res = await storage.objects.list({ bucket, prefix, pageToken, fields: "items(name),nextPageToken" });
        res.data.items?.forEach((o) => o.name && existing.add(o.name));
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }
    if (existing.size === 0) reportsError = `aucun rapport encore publié dans gs://${bucket}`;
  } catch (e) {
    reportsError = (e as { code?: number }).code === 403
      ? "accès aux rapports (bucket) pas encore activé par Google — ça peut prendre jusqu'à 24-48 h après l'invitation"
      : (e as Error).message;
  }

  const keys = monthKeys(months);
  const load = async (name: (m: string) => string): Promise<Row[]> => {
    const files = keys.map(name).filter((f) => existing.has(f));
    const parts = await Promise.all(
      files.map(async (object) => {
        const res = await storage.objects.get({ bucket, object, alt: "media" }, { responseType: "arraybuffer" });
        return parseCsv(decodeReport(Buffer.from(res.data as ArrayBuffer)));
      }),
    );
    return parts.flat();
  };

  const [overview, country, device, os, appVersion, language, ratings, crashes, acq, storePerf, reviews, vitalsResult] = await Promise.all([
    load((m) => `stats/installs/installs_${pkg}_${m}_overview.csv`),
    load((m) => `stats/installs/installs_${pkg}_${m}_country.csv`),
    load((m) => `stats/installs/installs_${pkg}_${m}_device.csv`),
    load((m) => `stats/installs/installs_${pkg}_${m}_os_version.csv`),
    load((m) => `stats/installs/installs_${pkg}_${m}_app_version.csv`),
    load((m) => `stats/installs/installs_${pkg}_${m}_language.csv`),
    load((m) => `stats/ratings/ratings_${pkg}_${m}_overview.csv`),
    load((m) => `stats/crashes/crashes_${pkg}_${m}_overview.csv`),
    load((m) => `acquisition/retained_installers/retained_installers_${pkg}_${m}_channel.csv`),
    // Format actuel de Google (sans rétention des installeurs).
    load((m) => `stats/store_performance/store_performance_${pkg}_${m}_traffic_source.csv`),
    load((m) => `reviews/reviews_${pkg}_${m}.csv`),
    fetchVitals(auth, pkg, months * 31).catch((e: Error) => e),
  ]);
  if (reportsError && vitalsResult instanceof Error) throw new Error(`${reportsError} ; vitals : ${vitalsResult.message}`);
  const vitals = vitalsResult instanceof Error ? [] : vitalsResult;

  return {
    source: "live",
    error: reportsError ? `Play Store en direct partiel : ${reportsError}. Crashs / ANR / utilisateurs Android sont réels ; installations, notes et avis arriveront ensuite.` : undefined,
    installs: overview
      .map((r) => ({
        date: str(r, "date"),
        installs: num(r, "daily device installs", "install events"),
        uninstalls: num(r, "daily device uninstalls", "uninstall events"),
        upgrades: num(r, "daily device upgrades", "update events"),
        userInstalls: num(r, "daily user installs"),
        userUninstalls: num(r, "daily user uninstalls"),
        totalUserInstalls: num(r, "total user installs"),
        activeDevices: num(r, "active device installs"),
      }))
      .filter((r) => r.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
    byCountry: breakdownRows(country, "country"),
    byDevice: breakdownRows(device, "device"),
    byOs: breakdownRows(os, "android os version"),
    byAppVersion: breakdownRows(appVersion, "app version code"),
    byLanguage: breakdownRows(language, "language"),
    ratings: ratings
      .map((r) => ({ date: str(r, "date"), daily: numOrNull(r, "daily average rating"), total: numOrNull(r, "total average rating") }))
      .filter((r) => r.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
    crashes: crashes
      .map((r) => ({ date: str(r, "date"), crashes: num(r, "daily crashes"), anrs: num(r, "daily anrs") }))
      .filter((r) => r.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
    acquisition: (acq.length ? acq.map(acquisitionRow) : storePerf.map(storePerformanceRow)).filter((r) => r.date),
    reviews: reviews.map(reviewRow).sort((a, b) => b.date.localeCompare(a.date)),
    vitals,
  };
}

/** Une ligne par (date, dimension) ; l'agrégation par période se fait dans aggregateBreakdown. */
function breakdownRows(rows: Row[], dim: string): BreakdownDaily[] {
  return rows
    .map((r) => ({
      name: str(r, dim) || "Inconnu",
      date: str(r, "date"),
      installs: num(r, "daily device installs", "install events"),
      uninstalls: num(r, "daily device uninstalls", "uninstall events"),
      active: num(r, "active device installs"),
    }))
    .filter((r) => r.date);
}

/** Somme installs/désinstalls sur la période ; "active" = dernière valeur connue de la période. */
export function aggregateBreakdown(rows: BreakdownDaily[], from: string, top = 10): Breakdown[] {
  const inRange = rows.filter((r) => r.date >= from);
  const lastDate = inRange.reduce((m, r) => (r.date > m ? r.date : m), "");
  const map = new Map<string, Breakdown>();
  for (const r of inRange) {
    const b = map.get(r.name) ?? { name: r.name, installs: 0, uninstalls: 0, active: 0 };
    b.installs += r.installs;
    b.uninstalls += r.uninstalls;
    if (r.date === lastDate) b.active = r.active;
    map.set(r.name, b);
  }
  const sorted = [...map.values()].sort((a, b) => b.installs - a.installs || b.active - a.active);
  if (sorted.length <= top) return sorted;
  const rest = sorted.slice(top - 1).reduce(
    (o, b) => ({ ...o, installs: o.installs + b.installs, uninstalls: o.uninstalls + b.uninstalls, active: o.active + b.active }),
    { name: "Autres", installs: 0, uninstalls: 0, active: 0 },
  );
  return [...sorted.slice(0, top - 1), rest];
}

function acquisitionRow(r: Row): Acquisition {
  const retained: Record<number, number> = {};
  for (const [k, v] of Object.entries(r)) {
    const m = k.match(/^installers retained for (\d+) days?$/);
    if (m) retained[Number(m[1])] = Number(v) || 0;
  }
  return {
    date: str(r, "date"),
    channel: str(r, "acquisition channel") || "Total",
    visitors: num(r, "store listing visitors"),
    installers: num(r, "installers"),
    retained,
  };
}

function storePerformanceRow(r: Row): Acquisition {
  return {
    date: str(r, "date"),
    channel: str(r, "traffic source") || "Autre",
    visitors: num(r, "store listing visitors"),
    installers: num(r, "store listing acquisitions"),
    retained: {},
  };
}

function reviewRow(r: Row): Review {
  const millis = num(r, "review last update millis since epoch", "review submit millis since epoch");
  return {
    date: millis ? new Date(millis).toISOString().slice(0, 10) : str(r, "review submit date and time").slice(0, 10),
    stars: num(r, "star rating"),
    title: str(r, "review title"),
    text: str(r, "review text"),
    lang: str(r, "reviewer language"),
    device: str(r, "device"),
    version: str(r, "app version name"),
    replied: Boolean(str(r, "developer reply text")),
    link: str(r, "review link"),
  };
}

/** Android vitals (taux de crash / ANR perçus, utilisateurs distincts) via la Play Developer Reporting API. */
async function fetchVitals(auth: InstanceType<typeof google.auth.GoogleAuth>, pkg: string, days: number): Promise<DailyVitals[]> {
  const api = google.playdeveloperreporting({ version: "v1beta1", auth });
  const end = addDays(today(), -2);
  const start = addDays(end, -Math.min(days, 365));
  const ymd = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    return { year, month, day, timeZone: { id: "America/Los_Angeles" } };
  };
  const timelineSpec = { aggregationPeriod: "DAILY", startTime: ymd(start), endTime: ymd(end) };
  const [crash, anr] = await Promise.all([
    api.vitals.crashrate.query({
      name: `apps/${pkg}/crashRateMetricSet`,
      requestBody: { timelineSpec, metrics: ["userPerceivedCrashRate", "distinctUsers"], pageSize: 1000 },
    }),
    api.vitals.anrrate.query({
      name: `apps/${pkg}/anrRateMetricSet`,
      requestBody: { timelineSpec, metrics: ["userPerceivedAnrRate"], pageSize: 1000 },
    }),
  ]);
  const map = new Map<string, DailyVitals>();
  const key = (t?: { year?: number | null; month?: number | null; day?: number | null } | null) =>
    t ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` : "";
  const metric = (row: { metrics?: { metric?: string | null; decimalValue?: { value?: string | null } | null }[] }, name: string) => {
    const v = row.metrics?.find((m) => m.metric === name)?.decimalValue?.value;
    return v == null ? null : Number(v);
  };
  for (const row of crash.data.rows ?? []) {
    const d = key(row.startTime);
    map.set(d, { date: d, crashRate: metric(row, "userPerceivedCrashRate"), distinctUsers: metric(row, "distinctUsers"), anrRate: null });
  }
  for (const row of anr.data.rows ?? []) {
    const d = key(row.startTime);
    const cur = map.get(d) ?? { date: d, crashRate: null, distinctUsers: null, anrRate: null };
    cur.anrRate = metric(row, "userPerceivedAnrRate");
    map.set(d, cur);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
