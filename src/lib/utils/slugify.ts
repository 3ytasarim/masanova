const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/**
 * İşletme adından URL/DNS-güvenli kısa ad önerisi: "Beyoğlu Çorbacısı" → "beyoglu-corbacisi".
 * Yalnızca öneridir; kesin doğrulama sunucuda (tenantSlugSchema + benzersizlik).
 */
export function slugify(input: string, maxLength = 63): string {
  const lower = input.toLocaleLowerCase("tr-TR");
  const mapped = Array.from(lower, (ch) => TR_MAP[ch] ?? ch).join("");
  const ascii = mapped.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const slug = ascii
    .replace(/&/g, " ve ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug.slice(0, maxLength).replace(/-+$/, "");
}
