import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { getServerEnv } from "@/lib/env";
import { ROOT_HOSTNAME } from "@/lib/domain/root-domain";
import { checkDatabase } from "@/server/services/system.service";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Sistem" };

export default async function AdminSystemPage() {
  await requireSuperAdmin();
  const env = getServerEnv();
  const database = await checkDatabase();

  // Yalnızca sır olmayan yapılandırma gösterilir. Bağlantı dizesi yalnızca host düzeyinde (kimlik bilgisi olmadan).
  const dbHost = (() => {
    try {
      return new URL(env.DATABASE_URL).host;
    } catch {
      return "geçersiz";
    }
  })();

  const rows: [string, React.ReactNode][] = [
    ["Ortam", <Badge key="env" tone={env.NODE_ENV === "production" ? "success" : "info"}>{env.NODE_ENV}</Badge>],
    ["Uygulama URL", env.NEXT_PUBLIC_APP_URL],
    ["Kök alan (kiracı alt alanları)", `*.${ROOT_HOSTNAME}`],
    ["Veritabanı sunucusu", dbHost],
    [
      "Veritabanı",
      database.status === "connected" ? (
        <Badge key="db" tone="success" dot>Bağlı · {database.latencyMs} ms</Badge>
      ) : (
        <Badge key="db" tone="danger" dot>Bağlantı yok</Badge>
      ),
    ],
    ["Node.js", process.version],
  ];

  return (
    <>
      <PageHeader
        title="Sistem"
        description="Servis durumu ve sır içermeyen platform yapılandırması."
        actions={
          <Link href="/admin/sistem/ui-kit" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <LayoutGrid aria-hidden="true" />
            Tasarım sistemi
          </Link>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Durum</CardTitle>
          <CardDescription>
            Makine tarafından okunabilir sürüm: <code className="font-mono text-xs">/api/health</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <dl className="divide-y divide-border">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <dt className="text-sm text-fg-subtle">{label}</dt>
                <dd className="break-all text-sm font-medium text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </>
  );
}
