import type { ServiceRequestStatus, ServiceRequestType } from "@prisma/client";

/**
 * Masa servis talebi tipleri — serbest metin DEĞİL, tipli değerler. Yeni tip eklemek: Prisma enum + bu listeler +
 * müşteri metinleri (i18n-service.ts). CUSTOM yalnızca kısa düz metin not taşır.
 */
export const SERVICE_REQUEST_TYPES = ["WAITER", "WATER", "NAPKIN", "BILL", "CUSTOM"] as const satisfies readonly ServiceRequestType[];

/** Personel ekranı (işletmenin varsayılan dili; müşteri dili operasyon arayüzüne karışmaz). */
export const SERVICE_TYPE_LABELS: Record<ServiceRequestType, string> = {
  WAITER: "Garson Çağrısı",
  WATER: "Su İsteği",
  NAPKIN: "Peçete İsteği",
  BILL: "Hesap İsteği",
  CUSTOM: "Özel İstek",
};

export const SERVICE_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  OPEN: "Bekliyor",
  ACKNOWLEDGED: "İlgileniliyor",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal edildi",
};

export const SERVICE_STATUS_TONES: Record<ServiceRequestStatus, "warning" | "info" | "success" | "neutral"> = {
  OPEN: "warning",
  ACKNOWLEDGED: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

/** Özel istek notu üst sınırı (veritabanında da CHECK). */
export const SERVICE_NOTE_MAX = 160;

/** Yüksek entropili public kimlik biçimi (16 bayt base64url = 22 karakter). */
export const SERVICE_PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

/** Personelin güvenli görünen adı: "Merve K." — e-posta / tam soyad gösterilmez. */
export function staffDisplayName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = (firstName ?? "").trim().split(/\s+/)[0] ?? "";
  const initial = (lastName ?? "").trim().charAt(0);
  if (!first) return initial ? `${initial.toLocaleUpperCase("tr-TR")}.` : "Personel";
  return initial ? `${first} ${initial.toLocaleUpperCase("tr-TR")}.` : first;
}
