/**
 * Kampanya mesaj şablonu — DÜZ METİN. Yalnızca beyaz listedeki yer tutucular ({{firstName}}, {{restaurantName}},
 * {{couponCode}}) değiştirilir; kod / ifade / HTML yürütülmez. Bilinmeyen yer tutucu kaydı engeller.
 */
export const TEMPLATE_PLACEHOLDERS = ["firstName", "restaurantName", "couponCode"] as const;
export type PlaceholderName = (typeof TEMPLATE_PLACEHOLDERS)[number];
export const TEMPLATE_MAX = 1000;

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function templateProblems(template: string): string[] {
  const problems: string[] = [];
  if (template.length > TEMPLATE_MAX) problems.push(`En fazla ${TEMPLATE_MAX} karakter.`);
  for (const m of template.matchAll(TOKEN)) {
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(m[1]!)) problems.push(`Bilinmeyen alan: {{${m[1]}}}`);
  }
  return [...new Set(problems)];
}

export function renderTemplate(template: string, values: Partial<Record<PlaceholderName, string | null>>): string {
  return template.replace(TOKEN, (whole, name: string) => ((TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name) ? (values[name as PlaceholderName] ?? "") : whole));
}
