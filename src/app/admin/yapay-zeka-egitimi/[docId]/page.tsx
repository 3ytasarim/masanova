import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { deleteKnowledgeAction, saveKnowledgeAction } from "@/server/actions/knowledge.actions";
import { findKnowledge } from "@/server/services/ai/knowledge.service";
import { KnowledgeForm } from "@/components/admin/knowledge-editor";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Eğitim Metni" };

export default async function EditKnowledgePage({ params }: { params: Promise<{ docId: string }> }) {
  const { platform } = await requireSuperAdmin();
  const { docId } = await params;
  const doc = /^[a-z0-9]{20,40}$/.test(docId) ? await findKnowledge(platform, docId) : null;
  if (!doc) notFound();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/yapay-zeka-egitimi" className="hover:text-fg">
            Yapay Zeka Eğit
          </Link>
        }
        title={doc.title}
        actions={
          <ConfirmDialog
            action={deleteKnowledgeAction.bind(null, doc.id)}
            triggerLabel="Sil"
            title="Eğitim metnini sil"
            description="Bu metin tüm işletmelerin garsonundan kaldırılır ve geri alınamaz. Geçici olarak durdurmak için Etkin anahtarını kapatabilirsiniz."
            confirmLabel="Sil"
            destructive
          />
        }
      />
      <Card>
        <CardContent className="pt-5">
          <KnowledgeForm mode="edit" action={saveKnowledgeAction.bind(null, doc.id)} cancelHref="/admin/yapay-zeka-egitimi" defaults={{ title: doc.title, content: doc.content, active: doc.active, sortOrder: doc.sortOrder }} />
        </CardContent>
      </Card>
    </>
  );
}
