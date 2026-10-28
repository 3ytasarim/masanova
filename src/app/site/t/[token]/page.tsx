import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_PARAM, pickPublicLocale } from "@/lib/public-menu/i18n";
import { shouldCountScan } from "@/lib/tables/scan-count";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import { recordQrScan } from "@/server/repositories/table-qr.repository";
import { ensureMenuTranslated } from "@/server/services/menu/auto-translate.service";
import { getCachedPublicPresentation, getCachedPublishedMenu } from "@/server/services/public-menu/public-menu-cache";
import { cartScopeFor, createMenuRefs } from "@/server/services/orders/menu-refs";
import { toPublicMenuView } from "@/server/services/public-menu/serialize";
import { listCustomerRequests } from "@/server/services/service-requests/customer-request.service";
import { getVoiceAiAccess } from "@/server/services/ai/access.service";
import { getTenantEntitlements } from "@/server/billing/entitlements";
import { publicAccountFor } from "@/server/crm/public-account";
import { realtimeConfig } from "@/server/services/ai/realtime-voice.service";
import { PublicMenu } from "@/components/public/public-menu";
import { loadVenue } from "@/server/services/public-menu/venue";

/**
 * Müşteri QR menüsü — kiracı alan adındaki /t/<token> (proxy.ts → /site/t/<token>).
 *
 * Güven zinciri: kiracı istek host'undan, masa / şube / bölge token'dan (getTableQrContext — her istekte canlı,
 * önbelleksiz). Menü verisi önbellekten (kiracı + şube + dil anahtarlı). Tarayıcıya yalnızca toPublicMenuView'un
 * küçültülmüş sözleşmesi gider. Geçersiz / iptal / pasif / askıdaki / başka kiracının token'ı → aynı nötr 404.
 * Okutma sayacının kanonik olayı burasıdır (belge açılışı); /q yönlendirmesi ve dil değişimi sayılmaz.
 */
type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await getTableQrContext((await params).token);
  return {
    title: { absolute: result.ok ? `${result.context.tenant.name} · ${result.context.table.name}` : "QR kod geçersiz" },
    robots: { index: false, follow: false, nocache: true, noarchive: true },
    // Token'lı adres dış kaynaklara (görsel sunucuları) Referer ile sızmasın.
    referrer: "no-referrer",
  };
}

export const viewport: Viewport = { themeColor: "#faf8f5" };

export default async function TableMenuPage({ params, searchParams }: Props) {
  const result = await getTableQrContext((await params).token);
  if (!result.ok) notFound();
  const { context } = result;

  if (shouldCountScan(await headers())) {
    // Yanıttan sonra; kişisel veri tutulmaz.
    after(() => recordQrScan(context.token.id, context.tenant.id));
  }

  const query = (await searchParams)[PUBLIC_LOCALE_PARAM];
  const presentation = await getCachedPublicPresentation(context.scope);
  const locale = pickPublicLocale({
    query: typeof query === "string" ? query : null,
    cookie: (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value ?? null,
    tenantDefault: presentation.defaultLocale,
  });
  const menu = await getCachedPublishedMenu(context.scope, { branchId: context.branch.id, locale });
  ensureMenuTranslated(context.tenant.id, menu);
  const token = (await params).token;
  const view = toPublicMenuView(menu, presentation, {
    table: { name: context.table.name, area: context.area?.name ?? null },
    refOf: createMenuRefs(context.tenant.id),
    ordering: { scope: cartScopeFor(context.tenant.id, context.table.id), token, returnPath: `/t/${token}` },
  });

  // Servis talepleri canlı ve önbelleksiz (menü önbelleğinden bağımsız); yalnızca bu masanın talepleri.
  const serviceRequests = await listCustomerRequests({ tenantId: context.tenant.id, tableId: context.table.id });

  // Sesli AI düğmesi yalnızca paket + işletme ayarı + sağlayıcı uygunsa (uç noktalar da ayrıca denetler).
  const { availability } = await getVoiceAiAccess(context.tenant.id);

  // Paket yetkileri (Sprint 20): menü her pakette çalışır; sipariş / servis / hesap yalnızca paket içeriyorsa gösterilir.
  // Müşteriye faturalama uyarısı GÖSTERİLMEZ. Gönderim uç noktaları ayrıca sunucuda reddeder.
  const ent = await getTenantEntitlements(context.tenant.id);
  // İsteğe bağlı müşteri hesabı (bu tarayıcının oturumu). Menü önbelleğine girmez; sesli AI'ya verilmez.
  const account = ent.has("crm") ? await publicAccountFor(context.tenant.id, token) : null;

  const venue = await loadVenue(context.tenant.id, context.branch.id, context.tenant.name, presentation.googleReviewUrl);

  return <PublicMenu venue={venue} realtimeVoice={availability.available && !!realtimeConfig()} view={view} serviceRequests={serviceRequests} assistantAvailable={availability.available} account={account} capabilities={{ ordering: ent.has("ordering"), service: ent.has("service_requests") }} />;
}

