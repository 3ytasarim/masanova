import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { FeatureSection } from "@/components/billing/feature-gate";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = { title: { absolute: "Kasa · MasaNova AI" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#0c0a09" };

/**
 * Kasa terminali — panel çerçevesi olmadan tam ekran (dokunmatik POS). Yalnızca Full paket (cashier_screen).
 * Oturum yoksa paket kapısından ÖNCE kasa girişine (girişten sonra buraya döner).
 */
export default async function CashierTerminalLayout({ children }: { children: React.ReactNode }) {
  if (!(await getCurrentSession())) redirect("/giris?sonra=kasa");
  return (
    <ToastProvider>
      <div className="min-h-dvh bg-stone-950">
        <FeatureSection feature="cashier_screen" mode="screen">
          {children}
        </FeatureSection>
      </div>
    </ToastProvider>
  );
}
