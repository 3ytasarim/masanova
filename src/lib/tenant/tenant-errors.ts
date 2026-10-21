/**
 * Kiracı çözümleme hataları. Mesajlar kullanıcıya gösterilebilecek kadar güvenlidir:
 * hangi host'un, hangi kiracının neden reddedildiği gibi iç ayrıntıları SIZDIRMAZ.
 */
export class TenantResolutionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

/** Host hiçbir aktif kiracıya karşılık gelmiyor (bilinmeyen, geçersiz, doğrulanmamış ya da platform host'u). */
export class TenantNotFoundError extends TenantResolutionError {
  constructor() {
    super("TENANT_NOT_FOUND", "İşletme bulunamadı.", 404);
  }
}

/** Kiracı var ama askıya alınmış ya da iptal edilmiş. */
export class TenantUnavailableError extends TenantResolutionError {
  constructor() {
    super("TENANT_UNAVAILABLE", "Bu işletme şu anda hizmet vermiyor.", 403);
  }
}
