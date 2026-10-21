/** Sunucu (Node) modülü: yerel argon2 bağımlılığı istemci paketine giremez. Seed betiği de kullanır. */
import { hash, verify } from "@node-rs/argon2";

/** OWASP önerisi (2024+) argon2id parametreleri: 19 MiB bellek, 2 iterasyon, 1 paralellik. */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Bozuk / bilinmeyen hash biçimi: başarısız giriş gibi davran, ayrıntı sızdırma.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Kullanıcı yoksa da aynı maliyette bir doğrulama yaparak yanıt süresinden e-posta varlığının
 * çıkarılmasını (user enumeration) zorlaştırır.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("masanova-dummy-password-for-timing-safety");
  await verifyPassword(await dummyHash, password);
  return false;
}
