import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { UiKitInteractive } from "@/components/dashboard/ui-kit-interactive";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const metadata: Metadata = { title: "Tasarım Sistemi" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** İç tasarım sistemi vitrini: tüm primitiflerin durumları tek ekranda (görsel regresyon referansı). */
export default async function UiKitPage() {
  await requireSuperAdmin();

  return (
    <>
      <PageHeader eyebrow="Sistem" title="Tasarım sistemi" description="MasaNova AI arayüz primitifleri ve durumları." />
      <div className="grid gap-6">
        <Section title="Button">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Birincil</Button>
            <Button variant="secondary">İkincil</Button>
            <Button variant="ghost">Hayalet</Button>
            <Button variant="accent">Vurgu</Button>
            <Button variant="danger">Sil</Button>
            <Button loading>Kaydediliyor</Button>
            <Button disabled>Pasif</Button>
            <Button size="sm" variant="secondary">Küçük</Button>
          </div>
        </Section>

        <Section title="Form kontrolleri">
          <div className="grid gap-5 md:grid-cols-2">
            <Field id="kit-name" label="İşletme adı" hint="Misafirlerin göreceği ad." required>
              <Input id="kit-name" placeholder="Beyoğlu Çorbacısı" aria-describedby="kit-name-hint" />
            </Field>
            <Field id="kit-email" label="E-posta" error="Geçerli bir e-posta girin.">
              <Input id="kit-email" defaultValue="hatali@" aria-invalid aria-describedby="kit-email-error" />
            </Field>
            <Field id="kit-currency" label="Para birimi">
              <Select id="kit-currency" defaultValue="TRY">
                <option value="TRY">Türk lirası (TRY)</option>
                <option value="EUR">Euro (EUR)</option>
                <option value="USD">ABD doları (USD)</option>
              </Select>
            </Field>
            <Field id="kit-disabled" label="Pasif alan">
              <Input id="kit-disabled" disabled defaultValue="Değiştirilemez" />
            </Field>
            <Field id="kit-note" label="Not" className="md:col-span-2">
              <Textarea id="kit-note" placeholder="Mutfak için not…" />
            </Field>
            <Checkbox id="kit-check" label="Alerjen bilgisini göster" description="Menüde ürün altında listelenir." defaultChecked />
            <Switch id="kit-switch" label="Masadan sipariş" description="Misafirler QR menüden sipariş verebilir." defaultChecked />
          </div>
        </Section>

        <Section title="Badge">
          <div className="flex flex-wrap gap-2">
            <Badge>Nötr</Badge>
            <Badge tone="accent">Vurgu</Badge>
            <Badge tone="success" dot>Aktif</Badge>
            <Badge tone="warning" dot>Askıda</Badge>
            <Badge tone="danger" dot>Hata</Badge>
            <Badge tone="info" dot>Deneme</Badge>
          </div>
        </Section>

        <Section title="Dialog · Dropdown · Tooltip · Tabs">
          <UiKitInteractive />
        </Section>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Bugünkü sipariş" value="128" hint="Örnek değer" />
          <StatCard label="Ortalama hazırlık" value="11 dk" hint="Örnek değer" />
          <div className="grid gap-3 rounded-lg border border-border bg-bg p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3.5 w-32" />
          </div>
        </div>

        <Table>
          <THead>
            <TR>
              <TH>Masa</TH>
              <TH>Bölge</TH>
              <TH>Durum</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD label="Masa" className="font-medium text-fg">12</TD>
              <TD label="Bölge">Teras</TD>
              <TD label="Durum"><Badge tone="success" dot>Dolu</Badge></TD>
            </TR>
            <TR>
              <TD label="Masa" className="font-medium text-fg">7</TD>
              <TD label="Bölge">Salon</TD>
              <TD label="Durum"><Badge dot>Boş</Badge></TD>
            </TR>
          </TBody>
        </Table>

        <Card>
          <CardHeader>
            <CardTitle>Kart başlığı</CardTitle>
            <CardDescription>Kart açıklaması ve alt bilgi alanı.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState icon={Inbox} title="Boş durum" description="Henüz veri olmadığında gösterilen açıklayıcı alan." />
          </CardContent>
          <CardFooter>
            <Button size="sm">Kaydet</Button>
            <Button size="sm" variant="ghost">Vazgeç</Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
