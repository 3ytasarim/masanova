import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { createCustomerAction } from "@/server/actions/crm.actions";
import { CustomerForm } from "@/components/crm/customer-forms";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Müşteri ekle" };

/** Personel elle müşteri ekler (kaynak: MANUAL_STAFF). Pazarlama izni verilemez. Destek modunda erişilemez. */
export default async function NewCustomerPage() {
  const ctx = await requireTenantUser({ permission: "crm.manage" });
  if (ctx.support) notFound();
  return (
    <>
      <Link href="/panel/musteriler" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" /> Müşteriler
      </Link>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Müşteri ekle</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">Telefonla rezervasyon gibi durumlarda müşteriyi elle kaydedin.</p>
      </header>
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <CustomerForm mode="create" action={createCustomerAction} defaults={{ firstName: "", lastName: "", phone: "", email: "", staffNote: "" }} cancelHref="/panel/musteriler" />
        </CardContent>
      </Card>
    </>
  );
}
