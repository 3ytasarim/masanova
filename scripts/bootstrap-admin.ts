/**
 * Üretim ilk Super Admin kurulumu (Sprint 21) — TEK SEFERLİK:
 *
 *   BOOTSTRAP_ADMIN_EMAIL=ops@sirket.com npm run bootstrap:admin
 *
 *  - Zaten bir Super Admin varsa HİÇBİR ŞEY yapmaz (çıkış 1) — tekrar çalıştırmak hesap ele geçirme yolu olamaz.
 *  - Kaynak kodda / env'de parola YOK: güçlü rastgele parola üretilir, argon2id ile saklanır ve YALNIZCA bir kez
 *    konsola yazılır. İlk girişten sonra değiştirin; konsol çıktısını kayıtlara / sohbete yapıştırmayın.
 *  - Demo kiracı / demo hesap OLUŞTURMAZ (geliştirme seed'i üretimde reddedilir).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { emailSchema } from "../src/lib/validation/schemas";

async function main() {
  const email = emailSchema.safeParse(process.env.BOOTSTRAP_ADMIN_EMAIL ?? "");
  if (!email.success) {
    console.error("BOOTSTRAP_ADMIN_EMAIL geçerli bir e-posta olmalı.");
    process.exit(1);
  }
  const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });
  try {
    const existing = await db.user.count({ where: { role: "SUPER_ADMIN" } });
    if (existing > 0) {
      console.error(`Zaten ${existing} Super Admin var — bootstrap çalışmaz (yeni yönetici panelden / destekten eklenir).`);
      process.exit(1);
    }
    if (await db.user.findUnique({ where: { email: email.data }, select: { id: true } })) {
      console.error("Bu e-posta başka bir kullanıcıda kayıtlı.");
      process.exit(1);
    }
    const password = randomBytes(18).toString("base64url");
    const user = await db.user.create({ data: { email: email.data, firstName: "Platform", lastName: "Yöneticisi", role: "SUPER_ADMIN", tenantId: null, passwordHash: await hashPassword(password) }, select: { id: true } });
    await db.auditLog.create({ data: { action: "USER_CREATED", entity: "User", entityId: user.id, userId: null, tenantId: null, metadata: { role: "SUPER_ADMIN", source: "bootstrap" } } });
    console.log(`Super Admin oluşturuldu: ${email.data}`);
    console.log(`Geçici parola (YALNIZCA BİR KEZ gösterilir, ilk girişte değiştirin): ${password}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("bootstrap başarısız:", e instanceof Error ? e.name : "hata");
  process.exit(1);
});
