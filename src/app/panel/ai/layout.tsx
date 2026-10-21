import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { AiTabs } from "@/components/advisor/ai-tabs";

/** AI bölümü: Sesli Asistan (ai.manage) · İşletme Danışmanı (advisor.view). Her sayfa kendi yetkisini ayrıca denetler. */
export default async function AiLayout({ children }: { children: React.ReactNode }) {
  const { user, support } = await requireTenantUser({ permission: "panel.view" });
  const role = support ? "TENANT_OWNER" : user.role;
  return (
    <>
      <AiTabs voice={hasPermission(role, "ai.manage")} advisor={hasPermission(role, "advisor.view")} />
      {children}
    </>
  );
}
