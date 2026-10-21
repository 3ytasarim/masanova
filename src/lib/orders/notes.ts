/**
 * Müşteri notları düz metindir: HTML / Markdown yorumlanmaz (React metin olarak basar). Burada yalnızca kontrol
 * karakterleri ve görünmez yön/biçim işaretleri temizlenir, boşluklar sadeleşir, uzunluk sınırlanır.
 */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

export function sanitizeNote(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const clean = value.replace(CONTROL, "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return clean ? clean.slice(0, max) : null;
}
