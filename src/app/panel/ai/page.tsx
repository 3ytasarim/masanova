import type { Metadata } from "next";
import { Eye, Info } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { formatRate, formatVoiceDuration } from "@/lib/ai/usage";
import { formatNumber } from "@/lib/utils/format";
import { getAiSettings, tenantHasFeature } from "@/server/services/ai/access.service";
import { getProviders } from "@/server/services/ai/config";
import { tenantUsage } from "@/server/services/ai/usage.service";
import { AiSettingsForm } from "@/components/ai/ai-settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "AI Asistan" };
export const dynamic = "force-dynamic";

/**
 * Sesli AI ayarları ve kullanım — ai.manage (sahip / müdür). Destek modu salt okunur. Sağlayıcı ayrıntısı / anahtar
 * gösterilmez; yalnızca "yapılandırılmış mı" bilgisi.
 */
export default async function AiSettingsPage() {
  const ctx = await requireTenantUser({ permission: "ai.manage" });
  const [settings, featureAvailable, tenantSettings] = await Promise.all([
    getAiSettings(ctx.scope.tenantId),
    tenantHasFeature(ctx.scope, "voice_ai"),
    prisma.tenantSettings.findUnique({ where: { tenantId: ctx.scope.tenantId }, select: { timezone: true } }),
  ]);
  const usage = await tenantUsage(ctx.scope.tenantId, tenantSettings?.timezone ?? "Europe/Istanbul");
  const providerReady = !!getProviders().ai;
  const rows = [
    { label: "Konuşma", today: formatNumber(usage.today.conversations), month: formatNumber(usage.month.conversations) },
    { label: "AI mesajı", today: formatNumber(usage.today.messages), month: formatNumber(usage.month.messages) },
    { label: "Ses (konuşma → metin)", today: formatVoiceDuration(usage.today.sttSeconds), month: formatVoiceDuration(usage.month.sttSeconds) },
    { label: "Sesli yanıt (karakter)", today: formatNumber(usage.today.ttsCharacters), month: formatNumber(usage.month.ttsCharacters) },
    { label: "Sesli oturum", today: formatNumber(usage.voiceToday.sessions), month: formatNumber(usage.voiceMonth.sessions) },
    { label: "Sesli konuşma süresi", today: formatVoiceDuration(usage.voiceToday.audioInSeconds + usage.voiceToday.audioOutSeconds), month: formatVoiceDuration(usage.voiceMonth.audioInSeconds + usage.voiceMonth.audioOutSeconds) },
    { label: "Söz kesme", today: formatNumber(usage.voiceToday.interruptions), month: formatNumber(usage.voiceMonth.interruptions) },
    { label: "Bas-konuşa düşen tur", today: `${formatNumber(usage.voiceToday.fallbackTurns)} (${formatRate(usage.voiceToday.fallbackRate)})`, month: `${formatNumber(usage.voiceMonth.fallbackTurns)} (${formatRate(usage.voiceMonth.fallbackRate)})` },
    { label: "Token (giriş / çıkış)", today: `${formatNumber(usage.today.inputTokens)} / ${formatNumber(usage.today.outputTokens)}`, month: `${formatNumber(usage.month.inputTokens)} / ${formatNumber(usage.month.outputTokens)}` },
  ];

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">AI Asistan</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">
          Müşterileriniz masadan sesli konuşarak menüyü sorar, öneri alır, sepete ekleme ve servis taleplerini onaylarıyla hazırlar. Asistan siparişi asla kendisi göndermez.
        </p>
        {ctx.support ? (
          <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Eye aria-hidden="true" className="size-4" /> Destek modu — salt okunur.
          </p>
        ) : null}
        {!featureAvailable ? (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning" data-testid="ai-plan-notice">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Voice AI mevcut paketinizde aktif değil. AI paketine geçildiğinde asistanı buradan açabilirsiniz.
          </p>
        ) : !providerReady ? (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-muted">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> AI hizmeti platformda henüz yapılandırılmadı; asistan müşterilere görünmez.
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Ayarlar</CardTitle>
            <CardDescription>Değişiklikler kaydedildiği anda yeni konuşmalara uygulanır.</CardDescription>
          </CardHeader>
          <CardContent>
            <AiSettingsForm
              readOnly={!!ctx.support}
              featureAvailable={featureAvailable}
              settings={{
                enabled: settings.enabled,
                assistantName: settings.assistantName,
                welcomeMessage: settings.welcomeMessage ?? "",
                tone: settings.tone,
                customInstructions: settings.customInstructions ?? "",
                allowRecommendations: settings.allowRecommendations,
                allowCartActions: settings.allowCartActions,
                allowServiceActions: settings.allowServiceActions,
                voiceEnabled: settings.voiceEnabled,
                defaultVoiceLanguage: settings.defaultVoiceLanguage ?? "",
              }}
            />
          </CardContent>
        </Card>
        <Card data-testid="ai-usage">
          <CardHeader>
            <CardTitle>Kullanım</CardTitle>
            <CardDescription>Bugün (restoran saatiyle) ve bu ay. Paket limiti tanımlanmadı.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-fg-subtle">
                  <th className="px-5 py-2 font-medium">Ölçüm</th>
                  <th className="px-2 py-2 text-right font-medium">Bugün</th>
                  <th className="px-5 py-2 text-right font-medium">Bu ay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className="px-5 py-2.5">{r.label}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{r.today}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{r.month}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
