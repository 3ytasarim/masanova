import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isProduction } from "@/lib/env";
import { TenantResolutionError } from "@/lib/tenant/tenant-errors";

/**
 * Tüm Route Handler'lar için tutarlı hata gövdesi:
 *   { "error": { "code": "TENANT_NOT_FOUND", "message": "İşletme bulunamadı." } }
 * Üretimde beklenmeyen hatalarda yığın izi / iç mesaj ASLA dönmez; ayrıntı sunucu loguna yazılır.
 */
export type ApiErrorBody = { error: { code: string; message: string; issues?: { path: string; message: string }[] } };

export function apiError(status: number, code: string, message: string, extra?: Pick<ApiErrorBody["error"], "issues">) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message, ...extra } }, { status });
}

export function toApiErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof TenantResolutionError) {
    return apiError(error.status, error.code, error.message);
  }
  if (error instanceof z.ZodError) {
    return apiError(400, "VALIDATION_ERROR", "Geçersiz istek.", {
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  console.error("[api] beklenmeyen hata", error);
  const message = !isProduction && error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu.";
  return apiError(500, "INTERNAL_ERROR", message);
}
