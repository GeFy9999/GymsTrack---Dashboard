import "server-only";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { DAY, addDays, daysBetween, isoDay, today } from "./format";

// Seuils de statut utilisateur (en jours depuis la dernière activité)
export const ACTIVE_DAYS = 7;
export const CHURN_DAYS = 21;

type UserRow = {
  id: string; name: string; email: string; createdAt: string; authProvider: string; language: string;
  weightUnit: string; isPro: number; proInterval: string | null; billingProvider: string; hasUsedTrial: number;
  proCurrentPeriodEnd: string | null; stripeSubscriptionId: string | null; proProductId: string | null;
  emailVerified: number; restTimerEnabled: number; barbellModeEnabled: number;
};
type SessionRow = { userId: string; date: string; completed: number; durationMinutes: number | null; muscleGroup: string };

export function dbPath() {
  return path.resolve(process.cwd(), process.env.GYMTRACK_DB_PATH ?? "../gym-track-v1/backend/dev.db");
}

function open() {
  const p = dbPath();
  if (!fs.existsSync(p)) throw new Error(`Base introuvable : ${p} (règle GYMTRACK_DB_PATH dans .env.local)`);
  return new Database(p, { readonly: true, fileMustExist: true });
}

function safeAll<T>(db: Database.Database, sql: string): T[] {
  try { return db.prepare(sql).all() as T[]; } catch { return []; }
}

const dayOf = (iso: string) => isoDay(new Date(iso));
const daysDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export type AppStats = ReturnType<typeof computeStats>;

export function getAppStats(rangeDays: number) {
  const db = open();
  try {
    const users = db.prepare(`SELECT id, name, email, createdAt, authProvider, language, weightUnit, isPro, proInterval,
      billingProvider, hasUsedTrial, proCurrentPeriodEnd, stripeSubscriptionId, proProductId, emailVerified,
      restTimerEnabled, barbellModeEnabled FROM "User"`).all() as UserRow[];
    const sessions = db.prepare(`SELECT userId, date, completed, durationMinutes, muscleGroup FROM "Session"`).all() as SessionRow[];
    const weights = safeAll<{ userId: string; date: string }>(db, `SELECT userId, date FROM "BodyWeight"`);
    const sets = safeAll<{ weight: number; reps: number; unit: string; completed: number; date: string }>(db,
      `SELECT s.weight, s.reps, s.unit, s.completed, se.date FROM "Set" s
       JOIN "SessionExercise" x ON x.id = s.sessionExerciseId JOIN "Session" se ON se.id = x.sessionId`);
    const distinctUsers = (table: string, where = "") =>
      new Set(safeAll<{ userId: string }>(db, `SELECT DISTINCT userId FROM "${table}" WHERE userId IS NOT NULL ${where}`).map((r) => r.userId));
    const features = {
      "Séance enregistrée": new Set(sessions.map((s) => s.userId)),
      "Poids corporel": distinctUsers("BodyWeight"),
      "Exercices suivis": distinctUsers("TrackedExercise"),
      "Programme (planning)": distinctUsers("Schedule"),
      "Photos de progression": distinctUsers("ProgressPhoto"),
      "Exercices perso": distinctUsers("Exercise", "AND isCustom = 1"),
      "Presets de séance": distinctUsers("ExercisePreset"),
      "Notes d'exercice": distinctUsers("ExerciseNote"),
      "Minuteur de repos": new Set(users.filter((u) => u.restTimerEnabled).map((u) => u.id)),
      "Mode barre (disques)": new Set(users.filter((u) => u.barbellModeEnabled).map((u) => u.id)),
    };
    return computeStats(users, sessions, weights, sets, features, rangeDays);
  } finally {
    db.close();
  }
}

function computeStats(
  users: UserRow[],
  sessions: SessionRow[],
  weights: { userId: string; date: string }[],
  sets: { weight: number; reps: number; unit: string; completed: number; date: string }[],
  features: Record<string, Set<string>>,
  rangeDays: number,
) {
  const now = today();
  const from = addDays(now, -rangeDays + 1);
  const prevFrom = addDays(from, -rangeDays);
  const tz = process.env.DASHBOARD_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ── Activité par utilisateur (séances + pesées) ───────────────────────────
  const activity = new Map<string, Set<string>>();
  const byDayUsers = new Map<string, Set<string>>();
  const addEvent = (uid: string, iso: string) => {
    const d = dayOf(iso);
    (activity.get(uid) ?? activity.set(uid, new Set()).get(uid)!).add(d);
    (byDayUsers.get(d) ?? byDayUsers.set(d, new Set()).get(d)!).add(uid);
  };
  sessions.forEach((s) => addEvent(s.userId, s.date));
  weights.forEach((w) => addEvent(w.userId, w.date));

  const sessionCount = new Map<string, number>();
  sessions.forEach((s) => sessionCount.set(s.userId, (sessionCount.get(s.userId) ?? 0) + 1));

  const userInfo = users.map((u) => {
    const days = [...(activity.get(u.id) ?? [])].sort();
    const signup = dayOf(u.createdAt);
    const last = days.at(-1) ?? null;
    const idle = last ? daysDiff(last, now) : null;
    const status: Status = !last ? "jamais actif" : idle! <= ACTIVE_DAYS ? "actif" : idle! <= CHURN_DAYS ? "à risque" : "parti";
    return { ...u, signup, days, last, idle, status, sessions: sessionCount.get(u.id) ?? 0, age: daysDiff(signup, now) };
  });
  const total = users.length;

  // ── Statuts (qui reste / qui part) ─────────────────────────────────────────
  const statusCounts = countBy(userInfo, (u) => u.status);
  const statusList: { name: Status; value: number }[] = (["actif", "à risque", "parti", "jamais actif"] as Status[]).map((s) => ({ name: s, value: statusCounts[s] ?? 0 }));

  // ── DAU / WAU / MAU ────────────────────────────────────────────────────────
  const windowCount = (end: string, len: number) => {
    const set = new Set<string>();
    for (let i = 0; i < len; i++) byDayUsers.get(addDays(end, -i))?.forEach((u) => set.add(u));
    return set.size;
  };
  const signupsByDay = countBy(userInfo, (u) => u.signup);
  const sessionsByDay = countBy(sessions, (s) => dayOf(s.date));
  const completedByDay = countBy(sessions.filter((s) => s.completed), (s) => dayOf(s.date));
  let cumulative = userInfo.filter((u) => u.signup < from).length;
  const daily = daysBetween(from, now).map((d) => {
    cumulative += signupsByDay[d] ?? 0;
    return {
      date: d,
      dau: byDayUsers.get(d)?.size ?? 0,
      wau: windowCount(d, 7),
      mau: windowCount(d, 30),
      signups: signupsByDay[d] ?? 0,
      totalUsers: cumulative,
      sessions: sessionsByDay[d] ?? 0,
      completed: completedByDay[d] ?? 0,
    };
  });
  const dau = byDayUsers.get(now)?.size ?? 0;
  const wau = windowCount(now, 7);
  const mau = windowCount(now, 30);

  // ── Rétention ─────────────────────────────────────────────────────────────
  // Dn = part des inscrits d'au moins n jours revenus le jour n ou après.
  const offsets = (u: (typeof userInfo)[number]) => u.days.map((d) => daysDiff(u.signup, d));
  const retentionAt = (n: number) => {
    const eligible = userInfo.filter((u) => u.age >= n);
    if (!eligible.length) return null;
    return { rate: eligible.filter((u) => offsets(u).some((o) => o >= n)).length / eligible.length, base: eligible.length };
  };
  const retentionCurve = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90]
    .map((n) => ({ day: n, ...retentionAt(n) }))
    // Sous 10 utilisateurs éligibles, le point est trop bruité pour la courbe.
    .filter((p) => p.rate != null && p.base! >= Math.min(10, users.length)) as { day: number; rate: number; base: number }[];
  const retention = Object.fromEntries([1, 7, 14, 30, 60, 90].map((n) => [n, retentionAt(n)]));

  // Cohortes hebdomadaires : % actifs la semaine k après l'inscription.
  const weekStart = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return addDays(iso, -((d.getUTCDay() + 6) % 7));
  };
  const cohortMap = new Map<string, typeof userInfo>();
  userInfo.forEach((u) => {
    const w = weekStart(u.signup);
    (cohortMap.get(w) ?? cohortMap.set(w, []).get(w)!).push(u);
  });
  const WEEKS = 9;
  const cohorts = [...cohortMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 12)
    .map(([week, members]) => ({
      week,
      size: members.length,
      weeks: Array.from({ length: WEEKS }, (_, k) => {
        if (addDays(week, 7 * k) > now) return null;
        const back = members.filter((u) => offsets(u).some((o) => o >= 7 * k && o < 7 * k + 7)).length;
        return back / members.length;
      }),
    }));

  // ── Activation ────────────────────────────────────────────────────────────
  const firstSession = new Map<string, number>();
  sessions.forEach((s) => {
    const t = Date.parse(s.date);
    if (t < (firstSession.get(s.userId) ?? Infinity)) firstSession.set(s.userId, t);
  });
  const firstSessionDelay = userInfo
    .map((u) => {
      const first = firstSession.get(u.id);
      return first ? (first - Date.parse(u.createdAt)) / 3_600_000 : null;
    })
    .filter((h): h is number => h != null && h >= 0);
  const activation = {
    atLeast1: userInfo.filter((u) => u.sessions >= 1).length,
    atLeast3: userInfo.filter((u) => u.sessions >= 3).length,
    atLeast10: userInfo.filter((u) => u.sessions >= 10).length,
    medianHoursToFirst: median(firstSessionDelay),
    sameDay: firstSessionDelay.filter((h) => h < 24).length,
  };
  const sessionHistogram = [
    ["0", 0, 0], ["1", 1, 1], ["2–4", 2, 4], ["5–9", 5, 9], ["10–24", 10, 24], ["25–49", 25, 49], ["50+", 50, Infinity],
  ].map(([name, lo, hi]) => ({ name: name as string, value: userInfo.filter((u) => u.sessions >= (lo as number) && u.sessions <= (hi as number)).length }));

  // ── Engagement ────────────────────────────────────────────────────────────
  const inRange = (iso: string, a = from, b = now) => { const d = dayOf(iso); return d >= a && d <= b; };
  const rangeSessions = sessions.filter((s) => inRange(s.date));
  const prevSessions = sessions.filter((s) => inRange(s.date, prevFrom, addDays(from, -1)));
  const durations = rangeSessions.map((s) => s.durationMinutes).filter((d): d is number => d != null && d > 0 && d < 400);
  const kg = (w: number, unit: string) => (unit === "lb" ? w * 0.453592 : w);
  const rangeSets = sets.filter((s) => s.completed && inRange(s.date));
  const volumeKg = rangeSets.reduce((t, s) => t + kg(s.weight, s.unit) * s.reps, 0);
  const activeInRange = new Set(rangeSessions.map((s) => s.userId)).size;

  const muscle = Object.entries(countBy(rangeSessions, (s) => normalizeMuscle(s.muscleGroup)))
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const hourFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" });
  const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const WD = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
  rangeSessions.forEach((s) => {
    const parts = hourFmt.formatToParts(new Date(s.date));
    const wd = WD.indexOf(parts.find((p) => p.type === "weekday")!.value);
    const h = Number(parts.find((p) => p.type === "hour")!.value);
    if (wd >= 0) heat[wd][h]++;
  });

  // ── Monétisation ──────────────────────────────────────────────────────────
  const pros = userInfo.filter((u) => u.isPro);
  const exPros = userInfo.filter((u) => !u.isPro && (u.stripeSubscriptionId || u.proCurrentPeriodEnd || u.proProductId));
  const newInRange = userInfo.filter((u) => u.signup >= from);
  const newPrev = userInfo.filter((u) => u.signup >= prevFrom && u.signup < from);

  const featureAdoption = Object.entries(features)
    .map(([name, set]) => ({ name, value: [...set].filter((id) => userInfo.some((u) => u.id === id)).length / Math.max(total, 1) }))
    .sort((a, b) => b.value - a.value);


  return {
    tz,
    total,
    from,
    dau, wau, mau,
    stickiness: mau ? dau / mau : null,
    statusList,
    daily,
    retention,
    retentionCurve,
    cohorts,
    activation,
    sessionHistogram,
    range: {
      newUsers: newInRange.length,
      newUsersPrev: newPrev.length,
      sessions: rangeSessions.length,
      sessionsPrev: prevSessions.length,
      completionRate: rangeSessions.length ? rangeSessions.filter((s) => s.completed).length / rangeSessions.length : null,
      avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      medianDuration: median(durations),
      sets: rangeSets.length,
      reps: rangeSets.reduce((t, s) => t + s.reps, 0),
      volumeKg,
      activeUsers: activeInRange,
      sessionsPerActiveUserWeek: activeInRange ? rangeSessions.length / activeInRange / (rangeDays / 7) : null,
      newActivated: newInRange.filter((u) => u.sessions > 0).length,
      newPro: newInRange.filter((u) => u.isPro).length,
    },
    muscle,
    heat,
    weekdays: WD,
    monetization: {
      pro: pros.length,
      exPro: exPros.length,
      trials: userInfo.filter((u) => u.hasUsedTrial).length,
      conversion: total ? pros.length / total : null,
      conversionActive: activation.atLeast1 ? pros.filter((u) => u.sessions > 0).length / activation.atLeast1 : null,
      byInterval: toList(countBy(pros, (u) => intervalLabel(u.proInterval))),
      byProvider: toList(countBy(pros, (u) => providerLabel(u.billingProvider))),
      proRetention: pros.length ? pros.filter((u) => u.status === "actif").length / pros.length : null,
      freeRetention: total - pros.length ? userInfo.filter((u) => !u.isPro && u.status === "actif").length / (total - pros.length) : null,
    },
    featureAdoption,
    breakdowns: {
      auth: toList(countBy(userInfo, (u) => (u.authProvider === "google" ? "Google" : "E-mail"))),
      language: toList(countBy(userInfo, (u) => u.language.toUpperCase())),
      unit: toList(countBy(userInfo, (u) => u.weightUnit)),
      verified: userInfo.filter((u) => u.emailVerified).length,
    },
    recentUsers: [...userInfo].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25).map(publicUser),
    topUsers: [...userInfo].sort((a, b) => b.sessions - a.sessions).slice(0, 10).map(publicUser),
    churnRecent: userInfo
      .filter((u) => u.status === "parti" && u.sessions >= 3)
      .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""))
      .slice(0, 10)
      .map(publicUser),
  };
}

type Status = "actif" | "à risque" | "parti" | "jamais actif";

function publicUser(u: UserRow & { signup: string; last: string | null; sessions: number; status: Status; idle: number | null }) {
  return { id: u.id, name: u.name, email: u.email, signup: u.signup, last: u.last, idle: u.idle, sessions: u.sessions, status: u.status, pro: Boolean(u.isPro), lang: u.language, auth: u.authProvider };
}

function countBy<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) { const k = key(x); out[k] = (out[k] ?? 0) + 1; }
  return out;
}
const toList = (o: Record<string, number>) => Object.entries(o).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const intervalLabel = (i: string | null) => ({ month: "Mensuel", year: "Annuel", lifetime: "À vie" })[i ?? ""] ?? "Autre / manuel";
const providerLabel = (p: string) => ({ stripe: "Stripe (web)", google_play: "Google Play", manual: "Manuel", apple: "App Store" })[p] ?? p;

const MUSCLES: Record<string, string> = { chest: "Pectoraux", pecs: "Pectoraux", legs: "Jambes", jambes: "Jambes", back: "Dos", dos: "Dos", shoulders: "Épaules", épaules: "Épaules", epaules: "Épaules", arms: "Bras", bras: "Bras", biceps: "Biceps", triceps: "Triceps", abs: "Abdos", abdos: "Abdos", cardio: "Cardio", glutes: "Fessiers", fessiers: "Fessiers" };
const normalizeMuscle = (m: string) => MUSCLES[m.trim().toLowerCase()] ?? m;
