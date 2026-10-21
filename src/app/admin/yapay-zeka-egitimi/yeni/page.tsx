import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { saveKnowledgeAction } from "@/server/actions/knowledge.actions";
import { KnowledgeForm } from "@/components/admin/knowledge-editor";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Yeni Eğitim Metni" };

export default async function NewKnowledgePage() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/yapay-zeka-egitimi" className="hover:text-fg">
            Yapay Zeka Eğit
          </Link>
        }
        title="Yeni eğitim metni"
      />
      <Card>
        <CardContent className="pt-5">
          <KnowledgeForm mode="create" action={saveKnowledgeAction.bind(null, null)} cancelHref="/admin/yapay-zeka-egitimi" defaults={{ title: "", content: "", active: true, sortOrder: 10 }} />
        </CardContent>
      </Card>
    </>
  );
}
