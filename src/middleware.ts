import { NextResponse, type NextRequest } from "next/server";

// Mot de passe du dashboard (authentification HTTP Basic). Obligatoire dès
// qu'il tourne ailleurs que sur ta machine : il affiche noms, courriels et
// revenus. Sans DASHBOARD_PASSWORD, tout est refusé en production.
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("DASHBOARD_PASSWORD manquant", { status: 503 });
  }

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (safeEqual(given, password)) return NextResponse.next();
  }
  return new NextResponse("Authentification requise", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="GymTrack Stats", charset="UTF-8"' },
  });
}

// Comparaison en temps constant (pas d'indice sur le nombre de caractères justes).
function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
