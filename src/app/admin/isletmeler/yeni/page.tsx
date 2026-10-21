import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { getLocaleOptions } from "@/lib/validation/intl";
import { OnboardingWizard } from "@/components/dashboard/onboarding/onboarding-wizard";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Yeni İşletme" };

export default async function NewTenantPage() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/isletmeler" className="hover:text-fg">
            İşletmeler
          </Link>
        }
        title="Yeni işletme oluştur"
        description="Restoran müşterisini; şube, alan adı, sahip hesabı, marka ve paketiyle tek seferde oluşturun."
      />
      <OnboardingWizard options={getLocaleOptions()} />
    </>
  );
}
