import type { PolicyViolation } from "@/lib/reservations/rules";

/** Panel hata metinleri (oluşturma sonucu → Türkçe). */
export type BookingFailureCode = PolicyViolation | "disabled" | "branch_invalid" | "area_invalid" | "closed" | "blackout" | "no_table" | "tables_invalid" | "idempotency_conflict";

export const BOOKING_ERRORS: Record<BookingFailureCode, string> = {
  disabled: "Rezervasyonlar kapalı. Ayarlar'dan açın.",
  branch_invalid: "Şube bulunamadı.",
  area_invalid: "Bölge bu şubeye ait değil.",
  closed: "Bu saatte şube kapalı (açılış saatlerine bakın).",
  blackout: "Bu zaman kapalı dönem olarak işaretli.",
  no_table: "Bu saat için uygun masa yok (dolu ya da kapasite yetersiz).",
  tables_invalid: "Seçilen masa(lar) bu rezervasyon için uygun değil.",
  idempotency_conflict: "Bu istek zaten farklı içerikle gönderildi.",
  party_too_small: "Kişi sayısı en azın altında.",
  party_too_large: "Kişi sayısı çevrim içi sınırın üstünde.",
  too_soon: "Rezervasyon için çok yakın bir saat.",
  too_far: "Rezervasyon en fazla izin verilen günden ileri.",
  in_past: "Geçmiş bir saate rezervasyon yapılamaz.",
};
