import type { Metadata } from "next";
import { GraduationCap, Plus } from "lucide-react";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { testKnowledgeAction } from "@/server/actions/knowledge.actions";
import { listKnowledge } from "@/server/services/ai/knowledge.service";
import { KnowledgeTester } from "@/components/admin/knowledge-editor";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Yapay Zeka Eğit" };

/**
 * Yapay Zeka Eğitimi — Super Admin'in yazdığı serbest eğitim metinleri (sağlık, beslenme, kalori …). TÜM işletmelerin
 * sesli / yazılı garsonu kullanır: konu geçince metnin ilgili bölümlerini okur, ürünleri işletmenin kendi menüsünden
 * (kalori bilgisiyle) seçer. "Dene" ile herhangi bir işletmenin menüsünde sonuç önizlenir.
 */
export default async function AiTrainingPage() {
  const { platform } = await requireSuperAdmin();
  const [docs, tenants] = await Promise.all([
    listKnowledge(platform),
    prisma.tenant.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const active = docs.filter((d) => d.active).length;

  return (
    <>
      <PageHeader
        title="Yapay Zeka Eğit"
        description="Buraya yazdığınız bilgiler tüm işletmelerin sesli garsonuna öğretilir. Garson müşterinin durumuna (şeker, tansiyon, hamilelik, kilo, kalori …) göre bu bilgiyle ve işletmenin menüsündeki kalorilerle öneri yapar."
        actions={
          <Link href="/admin/yapay-zeka-egitimi/yeni" className={buttonVariants({ size: "sm" })} data-testid="knowledge-new">
            <Plus aria-hidden="true" /> Yeni eğitim metni
          </Link>
        }
      />

      <section aria-label="Eğitim metinleri" className="mb-8">
        {docs.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="Henüz eğitim metni yok"
            description="İlk metni ekleyin: örneğin “Diyabet ve beslenme” ya da “Kalori rehberi”. Metin yokken garson yerleşik temel sağlık kurallarını kullanır."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Başlık</TH>
                <TH>Uzunluk</TH>
                <TH>Durum</TH>
                <TH>Güncelleme</TH>
                <TH>
                  <span className="sr-only">İşlemler</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {docs.map((d) => (
                <TR key={d.id} data-testid="knowledge-row">
                  <TD label="Başlık" className="font-medium text-fg">
                    {d.title}
                  </TD>
                  <TD label="Uzunluk" className="tabular-nums">{`${formatNumber(d.content.length)} karakter`}</TD>
                  <TD label="Durum">
                    {d.active ? (
                      <Badge tone="success" dot>
                        Etkin
                      </Badge>
                    ) : (
                      <Badge dot>Pasif</Badge>
                    )}
                  </TD>
                  <TD label="Güncelleme" className="whitespace-nowrap">
                    {formatDateTime(d.updatedAt)}
                  </TD>
                  <TD label="İşlemler" className="text-right">
                    <Link href={`/admin/yapay-zeka-egitimi/${d.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      Düzenle<span className="sr-only">: {d.title}</span>
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="mt-3 text-sm text-fg-subtle">{formatNumber(active)} etkin metin. Değişiklikler yeni başlayan konuşmalarda geçerli olur (en geç 30 saniye).</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Dene</CardTitle>
          <CardDescription>
            Bir işletme seçin ve müşterinin söyleyeceği cümleyi yazın: garsonun okuyacağı eğitim bölümlerini, menüden önereceği ve önermeyeceği ürünleri, kalori söylendiyse öğün planını görün.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KnowledgeTester action={testKnowledgeAction} tenants={tenants} />
        </CardContent>
      </Card>
    </>
  );
}
