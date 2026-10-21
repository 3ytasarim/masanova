/**
 * Okutma sayımının KANONİK olayı: kiracı alan adındaki /t/<token> sayfasının tarayıcıda belge (document) olarak
 * açılması. Bir fiziksel okutma iki yoldan da tam bir kez buraya varır:
 *   kararlı QR  → /q/<token> (SAYMAZ, yalnızca yönlendirir) → /t/<token> (sayar)
 *   eski doğrudan QR → /t/<token> (sayar)
 * Uygulama içi gezinme (dil değişimi = RSC isteği) ve ön yükleme (prefetch) sayılmaz.
 * Bilinen sınır: sayfanın elle yenilenmesi yeni bir belge isteğidir ve sayılır (kişisel veri tutmadan ayırt edilemez).
 */
export function shouldCountScan(headers: { get(name: string): string | null }): boolean {
  if (headers.get("rsc") !== null || headers.get("next-router-prefetch") !== null) return false;
  const purpose = (headers.get("purpose") ?? headers.get("sec-purpose") ?? "").toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return false;
  const dest = headers.get("sec-fetch-dest");
  return dest === null || dest === "document";
}
