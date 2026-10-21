import type { TenantStatus } from "@prisma/client";

/**
 * Kiracı durum makinesi. Yalnızca buradaki geçişlere izin verilir; servis katmanı geçişi ayrıca
 * "beklenen önceki durum" koşuluyla (iyimser eşzamanlılık) uygular.
 *
 * CANCELLED terminaldir: iptal edilen işletme bu sprintte yeniden açılamaz (veri silinmez, korunur).
 */
export const STATUS_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  TRIAL: ["ACTIVE", "SUSPENDED", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export const STATUS_LABELS: Record<TenantStatus, string> = {
  TRIAL: "Deneme",
  ACTIVE: "Aktif",
  SUSPENDED: "Askıda",
  CANCELLED: "İptal",
};

/** Geçiş düğmesi metni ve onay açıklaması. */
export const TRANSITION_COPY: Record<TenantStatus, { action: string; confirm: string; destructive: boolean }> = {
  ACTIVE: { action: "Aktifleştir", confirm: "İşletme aktif olacak; panel ve QR menü erişime açılır.", destructive: false },
  SUSPENDED: {
    action: "Askıya al",
    confirm: "İşletmenin paneli ve QR menüsü erişime kapanır. Hiçbir veri silinmez; daha sonra yeniden aktifleştirilebilir.",
    destructive: true,
  },
  CANCELLED: {
    action: "İptal et",
    confirm: "İşletme kalıcı olarak iptal edilir ve bu sprintte yeniden açılamaz. Veriler silinmez, arşivde kalır.",
    destructive: true,
  },
  TRIAL: { action: "Denemeye al", confirm: "", destructive: false },
};
