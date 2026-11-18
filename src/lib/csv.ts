// Play Console exporte ses rapports en UTF-16LE avec BOM ; on gère aussi l'UTF-8.
export function decodeReport(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  return buf.toString("utf8");
}

export type Row = Record<string, string>;

/** Parse un CSV (guillemets, virgules et retours ligne échappés). Clés normalisées en minuscules. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);

  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map(normKey);
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export const normKey = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ");

/** Valeur numérique d'une colonne (première clé présente parmi les alias). */
export function num(row: Row, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[normKey(k)];
    if (v !== undefined && v !== "") {
      const n = Number(v.replace(/[%\s]/g, "").replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

export function numOrNull(row: Row, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[normKey(k)];
    if (v !== undefined && v !== "" && v !== "NA") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function str(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[normKey(k)];
    if (v) return v;
  }
  return "";
}
