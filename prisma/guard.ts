/**
 * Prisma CLI güvenlik kilidi — prisma.config.ts tarafından HER prisma komutunda (npx prisma … dahil) çalıştırılır.
 *
 * Neden: 2026-10-11'de `prisma migrate diff --from-migrations … --shadow-database-url <DIRECT_URL>` çalıştırıldı;
 * Prisma shadow veritabanını tek kullanımlık sayıp SIFIRLADI ve geliştirme veritabanının tamamı silindi.
 *
 * Kurallar (varsayılan: engelle):
 *  1. Shadow DB (--shadow-database-url ya da SHADOW_DATABASE_URL), DATABASE_URL / DIRECT_URL ile AYNI veritabanı
 *     olamaz. Karşılaştırma metin değil KİMLİK üzerinden: Neon'da uç nokta kimliği (ep-…, "-pooler" eki atılır) +
 *     veritabanı adı; diğerlerinde host (localhost / 127.0.0.1 / ::1 eşdeğer) + port (varsayılan 5432) + veritabanı adı.
 *  2. Shadow gerektiren komut (migrate dev, migrate diff --from/--to-migrations) ayrı shadow olmadan çalışmaz.
 *  3. Veriyi silebilen komutlar (migrate reset, migrate dev, db push --force-reset / --accept-data-loss) yalnızca
 *     YEREL veritabanında ve açık onay değişkeniyle (MASANOVA_ALLOW_DB_RESET=I_UNDERSTAND_THIS_DROPS_DATA) çalışır;
 *     uzak (Neon vb.) veritabanında asla.
 * Salt-okur / ekleyici komutlar (generate, migrate deploy, migrate status, migrate diff --from-url …, db execute,
 * db seed, studio) etkilenmez. Güvenli migration SQL üretimi: npm run db:diff (shadow kullanmaz).
 * Sınır: aynı Neon dalına bağlı FARKLI iki uç nokta (ör. okuma kopyası) bağlantı dizesinden ayırt edilemez.
 */
export type DbIdentity = { kind: "neon" | "generic"; key: string; host: string; database: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const NEON_HOST = /^(ep-[a-z0-9]+(?:-[a-z0-9]+)*?)(?:-pooler)?\.[a-z0-9.-]*neon\.(?:tech|build)$/i;

function clean(url: string): string {
  return url.trim().replace(/^["']|["']$/g, "");
}

export function dbIdentity(raw: string | null | undefined): DbIdentity | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(clean(raw));
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/i.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
  // Neon: uç nokta kimliği host'tan ya da options=endpoint%3D… parametresinden
  const optionEndpoint = /endpoint=([a-z0-9-]+)/i.exec(decodeURIComponent(url.searchParams.get("options") ?? ""))?.[1];
  const neon = NEON_HOST.exec(host);
  const endpoint = (neon?.[1] ?? optionEndpoint ?? "").toLowerCase().replace(/-pooler$/, "");
  if (endpoint) return { kind: "neon", key: `neon:${endpoint}/${database}`, host, database };
  const normalizedHost = LOCAL_HOSTS.has(host) ? "localhost" : host;
  return { kind: "generic", key: `pg:${normalizedHost}:${url.port || "5432"}/${database}`, host: normalizedHost, database };
}

/** Aynı veritabanı mı? Ayrıştırılamayan URL'de yalnızca birebir metin eşitliği. */
export function sameDatabase(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (clean(a) === clean(b)) return true;
  const ia = dbIdentity(a);
  const ib = dbIdentity(b);
  return !!ia && !!ib && ia.key === ib.key;
}

export function isLocalDatabase(raw: string | null | undefined): boolean {
  const id = dbIdentity(raw);
  return !!id && id.kind === "generic" && id.host === "localhost";
}

export const RESET_OVERRIDE = "I_UNDERSTAND_THIS_DROPS_DATA";

export type GuardDecision = { ok: true } | { ok: false; reason: string };

/** Bayrak değeri: "--ad=değer" biçimi önceliklidir; "--ad değer" biçiminde değer başka bir bayrak olamaz. */
function flagValue(args: string[], name: string): string | null {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  const next = i >= 0 ? args[i + 1] : undefined;
  return next && !next.startsWith("-") ? next : null;
}

/** prisma CLI argümanları (bin sonrası) + ortamdan karar. */
export function checkPrismaCommand(args: readonly string[], env: Record<string, string | undefined>): GuardDecision {
  const list = [...args];
  const words = list.filter((a) => !a.startsWith("-"));
  const [group, sub] = words;
  const command = `${group ?? ""} ${sub ?? ""}`.trim();
  const mainDbs = [env.DATABASE_URL, env.DIRECT_URL].filter((u): u is string => !!u);

  const shadowFlag = flagValue(list, "--shadow-database-url");
  const needsShadow = command === "migrate dev" || (command === "migrate diff" && (list.includes("--from-migrations") || list.includes("--to-migrations") || list.some((a) => a.startsWith("--from-migrations=") || a.startsWith("--to-migrations="))));
  const shadow = shadowFlag ?? (needsShadow ? (env.SHADOW_DATABASE_URL ?? null) : null);

  if (shadow) {
    const clash = mainDbs.find((db) => sameDatabase(shadow, db));
    if (clash)
      return {
        ok: false,
        reason:
          "Shadow veritabanı, ana veritabanıyla (DATABASE_URL / DIRECT_URL) AYNI. Prisma shadow veritabanını SIFIRLAR — bu komut ana veriyi siler. Ayrı, boş bir shadow / test veritabanı (ör. ayrı bir Neon dalı) kullanın ya da shadow gerektirmeyen `npm run db:diff` komutunu çalıştırın.",
      };
  }
  if (command === "migrate diff" && needsShadow && !shadow) {
    return { ok: false, reason: "`migrate diff --from/--to-migrations` ayrı bir shadow veritabanı gerektirir (SHADOW_DATABASE_URL). Ana veritabanı shadow olarak kullanılamaz. Güvenli alternatif: `npm run db:diff`." };
  }

  const destructive =
    command === "migrate reset" ||
    command === "migrate dev" ||
    (command === "db push" && (list.includes("--force-reset") || list.includes("--accept-data-loss")));
  if (destructive) {
    const target = env.DATABASE_URL;
    if (env.MASANOVA_ALLOW_DB_RESET !== RESET_OVERRIDE) {
      return { ok: false, reason: `\`prisma ${command}\` veriyi silebilir ve varsayılan olarak ENGELLİ. Yalnızca yerel bir test veritabanında MASANOVA_ALLOW_DB_RESET=${RESET_OVERRIDE} ile çalıştırılabilir. Uzak veritabanına migration için: npm run db:diff → migration dosyası → npm run db:deploy.` };
    }
    if (!isLocalDatabase(target)) {
      return { ok: false, reason: `\`prisma ${command}\` uzak veritabanında (Neon vb.) hiçbir koşulda çalıştırılmaz — onay değişkeni olsa bile. Yerel bir test veritabanı kullanın.` };
    }
  }
  return { ok: true };
}

/** prisma.config.ts içinden çağrılır: engellenen komutta açıklama yazar ve süreci durdurur. */
export function enforcePrismaGuard(argv: readonly string[] = process.argv, env: Record<string, string | undefined> = process.env): void {
  const binIndex = argv.findIndex((a) => /prisma(\.js|\.cmd|\.exe)?$|[\\/]prisma[\\/]build[\\/]index\.js$/i.test(a));
  const args = binIndex >= 0 ? argv.slice(binIndex + 1) : argv.slice(2);
  const decision = checkPrismaCommand(args, env);
  if (!decision.ok) {
    console.error(`\n✖ MasaNova Prisma güvenlik kilidi: ${decision.reason}\n`);
    process.exit(1);
  }
}
