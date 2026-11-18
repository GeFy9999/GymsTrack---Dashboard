import { addDays, today } from "./format";
import type { Acquisition, BreakdownDaily, DailyCrashes, DailyInstalls, DailyRating, DailyVitals, PlayData, Review } from "./play-types";

// Données Play Store fictives mais réalistes, utilisées tant que la Play Console n'est pas branchée.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTRIES: [string, number][] = [["CA", 0.42], ["FR", 0.27], ["US", 0.09], ["BE", 0.06], ["CH", 0.04], ["MA", 0.04], ["DZ", 0.03], ["SN", 0.02], ["GB", 0.02], ["CI", 0.01]];
const DEVICES: [string, number][] = [["Samsung Galaxy S23", 0.14], ["Samsung Galaxy A54", 0.12], ["Google Pixel 8", 0.09], ["Samsung Galaxy A15", 0.08], ["Xiaomi Redmi Note 13", 0.08], ["Google Pixel 7a", 0.06], ["OnePlus 12", 0.04], ["Motorola moto g", 0.05], ["Samsung Galaxy S24", 0.07], ["Autres modèles", 0.27]];
const OS: [string, number][] = [["Android 15", 0.38], ["Android 14", 0.31], ["Android 13", 0.15], ["Android 16", 0.08], ["Android 12", 0.05], ["Android 11", 0.03]];
const LANGS: [string, number][] = [["fr_CA", 0.36], ["fr_FR", 0.31], ["en_CA", 0.12], ["en_US", 0.1], ["ar", 0.05], ["es_ES", 0.03], ["de_DE", 0.03]];
const CHANNELS: [string, number][] = [["Recherche Google Play", 0.58], ["Exploration Google Play", 0.21], ["Référents tiers", 0.14], ["Google Ads", 0.07]];
const REVIEWS = [
  [5, "Enfin une app simple pour suivre mes séances. Le minuteur de repos est parfait."],
  [5, "Super app, j'adore voir ma progression sur le développé couché."],
  [4, "Très bien mais j'aimerais pouvoir exporter en CSV directement depuis le téléphone."],
  [5, "Interface propre, pas de pub. Je recommande."],
  [3, "Bonne app mais la synchro a mis du temps après la mise à jour."],
  [2, "Crash quand j'ajoute une photo de progression sur mon Pixel."],
  [5, "Le mode barre olympique est génial pour calculer les disques."],
  [4, "Simple et efficace. Il manque un mode sombre plus foncé."],
  [1, "Impossible de me connecter avec Google depuis hier."],
  [5, "Meilleure app de muscu que j'ai testée, et en français !"],
] as const;

let memo: PlayData | null = null;

export function demoPlayData(): PlayData {
  if (memo && memo.installs.at(-1)?.date === today()) return memo;
  const r = rng(42);
  const days = 400;
  const start = addDays(today(), -days);
  const installs: DailyInstalls[] = [];
  const ratings: DailyRating[] = [];
  const crashes: DailyCrashes[] = [];
  const vitals: DailyVitals[] = [];
  const acquisition: Acquisition[] = [];
  const reviews: Review[] = [];
  const byCountry: BreakdownDaily[] = [];
  const byDevice: BreakdownDaily[] = [];
  const byOs: BreakdownDaily[] = [];
  const byLanguage: BreakdownDaily[] = [];
  const byAppVersion: BreakdownDaily[] = [];

  let active = 120;
  let totalUsers = 160;
  let ratingSum = 4.4 * 12;
  let ratingCount = 12;

  for (let i = 0; i <= days; i++) {
    const date = addDays(start, i);
    const dow = new Date(date).getUTCDay();
    const growth = 4 + i * 0.07;
    const weekly = dow === 1 || dow === 0 ? 1.35 : dow === 5 || dow === 6 ? 0.8 : 1;
    const january = date.slice(5, 7) === "01" ? 1.6 : 1; // résolutions du Nouvel An
    const inst = Math.max(0, Math.round(growth * weekly * january * (0.7 + r() * 0.6)));
    const uninst = Math.round(inst * (0.28 + r() * 0.14) + active * 0.004 * r());
    active = Math.max(0, active + inst - uninst);
    const userInst = Math.round(inst * 0.92);
    totalUsers += userInst;
    installs.push({ date, installs: inst, uninstalls: uninst, upgrades: Math.round(active * (i % 21 < 4 ? 0.15 : 0.01)), userInstalls: userInst, userUninstalls: Math.round(uninst * 0.95), totalUserInstalls: totalUsers, activeDevices: active });

    const nRatings = r() < 0.18 ? 1 : 0;
    let daily: number | null = null;
    if (nRatings) {
      daily = r() < 0.75 ? 5 : r() < 0.6 ? 4 : r() < 0.5 ? 3 : 1;
      ratingSum += daily;
      ratingCount++;
    }
    ratings.push({ date, daily, total: ratingSum / ratingCount });

    const badRelease = i > days - 60 && i < days - 52;
    crashes.push({ date, crashes: Math.round(active * (badRelease ? 0.02 : 0.003) * r()), anrs: Math.round(active * 0.001 * r()) });
    vitals.push({ date, crashRate: (badRelease ? 0.014 : 0.003) + r() * 0.003, anrRate: 0.001 + r() * 0.002, distinctUsers: Math.round(active * (0.35 + r() * 0.1)) });

    for (const [channel, share] of CHANNELS) {
      const installers = Math.round(inst * share);
      const visitors = Math.round(installers / (0.22 + r() * 0.12)) + 1;
      acquisition.push({
        date, channel, visitors, installers,
        retained: { 1: Math.round(installers * 0.78), 7: Math.round(installers * 0.55), 15: Math.round(installers * 0.46), 30: Math.round(installers * 0.38) },
      });
    }

    const split = (list: [string, number][], into: BreakdownDaily[]) => {
      for (const [name, share] of list) into.push({ date, name, installs: Math.round(inst * share * (0.8 + r() * 0.4)), uninstalls: Math.round(uninst * share), active: Math.round(active * share) });
    };
    split(COUNTRIES, byCountry);
    split(DEVICES, byDevice);
    split(OS, byOs);
    split(LANGS, byLanguage);
    const v = Math.floor(i / 30);
    split([[`1.${v} (${100 + v})`, 0.7], [`1.${Math.max(0, v - 1)} (${99 + v})`, 0.22], [`1.${Math.max(0, v - 2)} (${98 + v})`, 0.08]], byAppVersion);

    if (daily && r() < 0.7) {
      const [stars, text] = REVIEWS.find(([s]) => s === daily) ?? REVIEWS[Math.floor(r() * REVIEWS.length)];
      reviews.push({ date, stars, title: "", text, lang: r() < 0.8 ? "fr" : "en", device: DEVICES[Math.floor(r() * 9)][0], version: `1.${v}`, replied: r() < 0.5, link: "" });
    }
  }

  memo = { source: "demo", installs, byCountry, byDevice, byOs, byAppVersion, byLanguage, ratings, crashes, acquisition, reviews: reviews.reverse(), vitals };
  return memo;
}
