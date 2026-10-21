import { InvalidQrView } from "@/components/public/invalid-qr";

export const metadata = { title: "QR kod geçersiz", robots: { index: false, follow: false } };

/** Geçersiz / iptal / pasif / başka işletmenin QR kodu — tek, nötr mesaj (ret nedeni sızdırılmaz). */
export default function InvalidQrPage() {
  return <InvalidQrView />;
}
