import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/utils/format";
import { updateDemoRequestAction } from "@/server/actions/demo-request.actions";
import { findDemoRequest } from "@/server/repositories/demo-request.repository";
import { DemoRequestBadge } from "@/components/dashboard/demo-request-badge";
import { DemoRequestUpdateForm } from "@/components/dashboard/demo-request-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Demo Talebi" };

export default async function DemoRequestDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { platform } = await requireSuperAdmin();
  const { requestId } = await params;
  const request = /^[a-z0-9]{20,40}$/.test(requestId) ? await findDemoRequest(platform, requestId) : null;
  if (!request) notFound();

  const rows: [string, React.ReactNode][] = [
    ["Kişi", request.name],
    ["E-posta", <a key="e" href={`mailto:${request.email}`} className="underline underline-offset-4">{request.email}</a>],
    ["Telefon", <a key="p" href={`tel:${request.phone.replace(/[^+0-9]/g, "")}`} className="underline underline-offset-4">{request.phone}</a>],
    ["Şehir", request.city ?? "—"],
    ["Tahmini masa sayısı", request.tableCount ?? "—"],
    ["Tarih", formatDateTime(request.createdAt)],
    ["Mesaj", request.message ? <span key="m" className="whitespace-pre-wrap">{request.message}</span> : "—"],
  ];

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/demo-talepleri" className="hover:text-fg">Demo Talepleri</Link>}
        title={request.businessName}
        actions={<DemoRequestBadge status={request.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Talep</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <dl className="divide-y divide-border">
              {rows.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:gap-4">
                  <dt className="text-sm text-fg-subtle sm:w-44 sm:shrink-0">{label}</dt>
                  <dd className="min-w-0 break-words text-sm text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Takip</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoRequestUpdateForm action={updateDemoRequestAction.bind(null, request.id)} status={request.status} notes={request.notes ?? ""} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
