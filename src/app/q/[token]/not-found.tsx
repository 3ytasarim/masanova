import { InvalidQrView } from "@/components/public/invalid-qr";

export const metadata = { title: "QR kod geçersiz", robots: { index: false, follow: false } };

export default function InvalidStableQr() {
  return <InvalidQrView />;
}
