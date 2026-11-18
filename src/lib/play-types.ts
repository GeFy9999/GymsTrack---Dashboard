export type DailyInstalls = {
  date: string;
  installs: number;        // Daily Device Installs
  uninstalls: number;      // Daily Device Uninstalls
  upgrades: number;
  userInstalls: number;    // Daily User Installs (nouveaux utilisateurs uniques)
  userUninstalls: number;
  totalUserInstalls: number;
  activeDevices: number;   // Active Device Installs (appareils où l'app est installée)
};

export type Breakdown = { name: string; installs: number; uninstalls: number; active: number };
export type BreakdownDaily = Breakdown & { date: string };

export type DailyRating = { date: string; daily: number | null; total: number | null };
export type DailyCrashes = { date: string; crashes: number; anrs: number };

export type Acquisition = {
  date: string;
  channel: string;
  visitors: number;
  installers: number;
  retained: Record<number, number>; // jour → installeurs encore là (1, 7, 15, 30)
};

export type Review = {
  date: string;
  stars: number;
  title: string;
  text: string;
  lang: string;
  device: string;
  version: string;
  replied: boolean;
  link: string;
};

export type DailyVitals = { date: string; crashRate: number | null; anrRate: number | null; distinctUsers: number | null };

export type PlayData = {
  source: "live" | "demo";
  error?: string;
  installs: DailyInstalls[];
  byCountry: BreakdownDaily[];
  byDevice: BreakdownDaily[];
  byOs: BreakdownDaily[];
  byAppVersion: BreakdownDaily[];
  byLanguage: BreakdownDaily[];
  ratings: DailyRating[];
  crashes: DailyCrashes[];
  acquisition: Acquisition[];
  reviews: Review[];
  vitals: DailyVitals[];
};
