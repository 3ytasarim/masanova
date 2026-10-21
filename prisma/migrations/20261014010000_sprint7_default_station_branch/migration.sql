-- Sprint 7 düzeltme: varsayılan istasyon bileşik FK'si "branches.id" yerine ayrı bir kolon üzerinden kurulur.
-- Sebep: id ilişki skaleri olunca Prisma checked create (iç içe / connect) id varsayılanını üretmiyordu.
-- Aynı-şube garantisi korunur: CHECK, default_station_branch_id = id (ya da ikisi birden NULL) şartını zorlar.

-- DropForeignKey
ALTER TABLE "branches" DROP CONSTRAINT "branches_default_station_id_id_tenant_id_fkey";

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "default_station_branch_id" TEXT;

-- Mevcut varsayılanlar
UPDATE "branches" SET "default_station_branch_id" = "id" WHERE "default_station_id" IS NOT NULL;

-- Satır içi kural (Prisma CHECK kısıtlarını modellemez; şema farkında görünmez)
ALTER TABLE "branches" ADD CONSTRAINT "branches_default_station_same_branch_chk" CHECK (
  ("default_station_id" IS NULL AND "default_station_branch_id" IS NULL)
  OR ("default_station_id" IS NOT NULL AND "default_station_branch_id" = "id")
);

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_default_station_id_default_station_branch_id_tena_fkey" FOREIGN KEY ("default_station_id", "default_station_branch_id", "tenant_id") REFERENCES "preparation_stations"("id", "branch_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
