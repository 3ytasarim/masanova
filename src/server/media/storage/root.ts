import path from "node:path";

/** Saf (server-only değil): bakım betikleri (npm run media:cleanup) de kullanır. */
const DEV_DEFAULT = "storage/uploads";
/** Yüklemelerin ASLA yazılmaması gereken uygulama klasörleri (depo / derleme çıktısı). */
const FORBIDDEN_DIRS = ["src", "public", ".next", "prisma", "node_modules", "app"];

/** Yükleme kökü: UPLOAD_ROOT ya da geliştirmede ./storage/uploads. Uygulama kaynak / derleme klasörlerinin içi reddedilir. */
export function resolveUploadRoot(configured: string | undefined, cwd = process.cwd()): string {
  const root = path.resolve(/* turbopackIgnore: true */ cwd, configured?.trim() || DEV_DEFAULT);
  for (const dir of FORBIDDEN_DIRS) {
    const forbidden = path.resolve(/* turbopackIgnore: true */ cwd, dir);
    if (root === forbidden || root.startsWith(forbidden + path.sep)) {
      throw new Error(`UPLOAD_ROOT uygulama klasörünün (${dir}/) içinde olamaz — yüklemeler kaynak koda / derleme çıktısına yazılmaz.`);
    }
  }
  if (root === path.resolve(/* turbopackIgnore: true */ cwd)) throw new Error("UPLOAD_ROOT uygulama kök klasörü olamaz.");
  return root;
}

