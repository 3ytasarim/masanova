import { FolderPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { listCategoryOptions } from "@/server/repositories/menu.repository";
import { getMenuPageContext } from "@/server/menu-page-context";
import { ProductCreateForm } from "@/components/menu/product-create-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Yeni Ürün" };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { scope, canManage, locales } = await getMenuPageContext();
  if (!canManage) notFound();
  const categories = await listCategoryOptions(scope);
  const roots = categories.filter((c) => c.parentId === null);
  const options = roots.flatMap((r) => [
    { value: r.id, label: r.name },
    ...categories.filter((c) => c.parentId === r.id).map((c) => ({ value: c.id, label: `${r.name} › ${c.name}` })),
  ]);
  const wanted = param(await searchParams, "kategori", 40);

  if (options.length === 0) {
    return (
      <EmptyState
        icon={FolderPlus}
        title="Önce bir kategori oluşturun"
        description="Her ürün bir kategoriye aittir."
        action={<Link href="/panel/menu/kategoriler?yeni=1" className={buttonVariants({ size: "sm" })}>Yeni Kategori</Link>}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Yeni ürün</CardTitle>
        <CardDescription>Temel bilgileri girin; kaydettikten sonra varyant, ekstra, içerik, görsel ve çevirileri ekleyebilirsiniz.</CardDescription>
      </CardHeader>
      <CardContent>
        <ProductCreateForm categories={options} currency={locales.currency} defaultCategoryId={options.some((o) => o.value === wanted) ? wanted : undefined} />
      </CardContent>
    </Card>
  );
}
