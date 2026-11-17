// Builds the alert email text for critical app errors. Pure, so it is unit
// tested. Rows come from public.client_errors, which the app scrubs before
// sending (no tokens, emails, phone numbers or face data), and only short
// fields are used here.
export type ErrorRow = {
  created_at: string;
  is_fatal: boolean;
  error_name: string | null;
  message: string | null;
  app_version: string | null;
  company_id: string | null;
};

export function isCritical(row: ErrorRow): boolean {
  return row.is_fatal || /parked as failed/i.test(row.message ?? "");
}

export function buildAlertText(rows: ErrorRow[], windowMinutes: number, maxLines = 5): string | null {
  const critical = rows.filter(isCritical);
  if (critical.length === 0) return null;
  const groups = new Map<string, { count: number; companies: Set<string>; versions: Set<string> }>();
  for (const r of critical) {
    const label = `${r.is_fatal ? "CRASH" : "SYNC"}: ${(r.error_name ?? "Error").slice(0, 40)}: ${(r.message ?? "").slice(0, 80)}`;
    const g = groups.get(label) ?? { count: 0, companies: new Set(), versions: new Set() };
    g.count++;
    if (r.company_id) g.companies.add(r.company_id);
    if (r.app_version) g.versions.add(r.app_version);
    groups.set(label, g);
  }
  const lines = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxLines)
    .map(([label, g]) => `- ${g.count}x ${label} (v${[...g.versions].join(",") || "?"}, ${g.companies.size} compan${g.companies.size === 1 ? "y" : "ies"})`);
  const more = groups.size > maxLines ? `\n...and ${groups.size - maxLines} more kinds` : "";
  return `Hazri alert: ${critical.length} critical error(s) in the last ${windowMinutes} min\n${lines.join("\n")}${more}\nDetails: table client_errors in Supabase.`;
}
