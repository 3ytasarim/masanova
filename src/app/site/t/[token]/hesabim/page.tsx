import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { textDirection } from "@/config/menu";
import { prisma } from "@/lib/db/prisma";
import { maskEmail, maskPhone } from "@/lib/crm/contact";
import { customerStrings } from "@/lib/crm/i18n";
import { formatMoney } from "@/lib/menu/money";
import { NUMBER_LOCALES, PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_PARAM, pickPublicLocale } from "@/lib/public-menu/i18n";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import { readCustomerIdentity } from "@/server/crm/customer-session";
import { getOwnProfile } from "@/server/crm/customer.service";
import { getLoyaltySettings, publicPointsBalance } from "@/server/crm/loyalty.service";
import { JoinForm } from "@/components/public/crm/join-form";
import { ProfilePanel } from "@/components/public/crm/profile-panel";

/**
 * Müşteri hesabı — /t/<token>/hesabim (kiracı alan adı). TAMAMEN İSTEĞE BAĞLI: sipariş için gerekmez.
 * Kimlik yalnızca bu tarayıcının müşteri oturum çerezinden; yoksa katılım formu gösterilir. Masa bağlamı yine QR'dan
 * (geçersiz QR → nötr 404). Personel notu, iç kimlik ya da kaynak gibi alanlar müşteriye GÖSTERİLMEZ.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Hesabım", robots: { index: false, follow: false, nocache: true, noarchive: true }, referrer: "no-referrer" };

export default async function CustomerAccountPage({ params, searchParams }: Props) {
  const { token } = await params;
  const result = await getTableQrContext(token);
  if (!result.ok) notFound();
  const { context } = result;
  const tenantId = context.tenant.id;
  const sp = await searchParams;

  const tenantSettings = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultLocale: true, defaultCurrency: true } });
  const query = sp[PUBLIC_LOCALE_PARAM];
  const locale = pickPublicLocale({ query: typeof query === "string" ? query : null, cookie: (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value ?? null, tenantDefault: tenantSettings?.defaultLocale ?? "tr" });
  const c = customerStrings(locale);

  const [identity, loyalty] = await Promise.all([readCustomerIdentity(tenantId), getLoyaltySettings(tenantId)]);
  const profile = identity ? await getOwnProfile(tenantId, identity.customerId) : null;
  const loyaltyActive = loyalty.enabled && !!loyalty.minorPerPoint;
  const amount = loyalty.minorPerPoint ? formatMoney(loyalty.minorPerPoint, tenantSettings?.defaultCurrency ?? "TRY", NUMBER_LOCALES[locale]) : "";
  const ruleText = loyaltyActive ? (loyalty.earnOn === "ACCEPTED" ? c.loyaltyRuleAccepted(amount) : c.loyaltyRule(amount)) : null;
  const fromParam = sp.from;
  const from = fromParam === "order" || fromParam === "loyalty" ? fromParam : "menu";

  return (
    <div dir={textDirection(locale)} lang={locale} className="min-h-dvh bg-[#faf8f5] text-stone-900">
      <main className="mx-auto max-w-xl px-4 pb-12 pt-6">
        <Link href={`/t/${token}`} className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-[0.9375rem] font-medium text-stone-700 hover:bg-stone-200/60">
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" /> {c.backToMenu}
        </Link>
        <p className="mt-4 text-[0.8125rem] font-medium uppercase tracking-[0.12em] text-stone-500">{context.tenant.name}</p>
        {profile && identity ? (
          <ProfilePanel
            token={token}
            locale={locale}
            profile={{
              firstName: profile.firstName,
              lastName: profile.lastName,
              phone: maskPhone(profile.phone),
              email: maskEmail(profile.email),
              phoneVerified: !!profile.phoneVerifiedAt,
              emailVerified: !!profile.emailVerifiedAt,
              consents: {
                LOYALTY: profile.consents.LOYALTY.state === "GRANTED",
                MARKETING_EMAIL: profile.consents.MARKETING_EMAIL.state === "GRANTED",
                MARKETING_SMS: profile.consents.MARKETING_SMS.state === "GRANTED",
                MARKETING_WHATSAPP: profile.consents.MARKETING_WHATSAPP.state === "GRANTED",
              },
            }}
            loyalty={{ active: loyaltyActive, ruleText, points: await publicPointsBalance(tenantId, identity.customerId) }}
          />
        ) : (
          <JoinForm token={token} locale={locale} from={from} loyalty={{ active: loyaltyActive, ruleText }} />
        )}
      </main>
    </div>
  );
}
