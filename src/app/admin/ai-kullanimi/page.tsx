import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { formatRate, formatVoiceDuration, monthStart } from "@/lib/ai/usage";
import { formatNumber } from "@/lib/utils/format";
import { getProviders } from "@/server/services/ai/config";
import { platformUsageByTenant, platformVoiceByTenant } from "@/server/services/ai/usage.service";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "AI Kullanımı" };
export const dynamic = "force-dynamic";

/**
 * Platform AI kullanımı — yalnızca meta veri (konuşma içeriği gösterilmez). Dönem: içinde bulunulan UTC ayı.
 * Sağlayıcı yalnızca adıyla (anahtar / model ayrıntısı yok).
 */
export default async function AdminAiUsagePage() {
  await requireSuperAdmin();
  const start = monthStart();
  const [rows, voice] = await Promise.all([platformUsageByTenant(start), platformVoiceByTenant(start)]);
  const providers = getProviders();
  const period = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);

  return (
    <>
      <PageHeader title="AI Kullanımı" description={`Dönem: ${period} (UTC). Konuşma içerikleri gösterilmez.`} />
      <p className="mb-4 flex flex-wrap gap-2 text-sm" data-testid="ai-providers">
        <Badge tone={providers.ai ? "success" : "neutral"}>AI: {providers.ai?.name ?? "yapılandırılmadı"}</Badge>
        <Badge tone={providers.stt ? "success" : "neutral"}>STT: {providers.stt?.name ?? "yapılandırılmadı"}</Badge>
        <Badge tone={providers.tts ? "success" : "neutral"}>TTS: {providers.tts?.name ?? "yapılandırılmadı"}</Badge>
      </p>
      {rows.length ? (
        <Table>
          <THead>
            <TR>
              <TH>İşletme</TH>
              <TH className="text-right">Konuşma</TH>
              <TH className="text-right">AI mesajı</TH>
              <TH className="text-right">Token (giriş / çıkış)</TH>
              <TH className="text-right">STT</TH>
              <TH className="text-right">TTS karakter</TH>
              <TH className="text-right">Sesli oturum</TH>
              <TH className="text-right">Ses dakikası</TH>
              <TH className="text-right">Yedek oranı</TH>
              <TH className="text-right">Sağlayıcı hata oranı</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const v = voice.get(r.tenant.id);
              return (
              <TR key={r.tenant.id} data-testid="ai-usage-row">
                <TD label="İşletme" className="font-medium text-fg">
                  {r.tenant.name} <Badge>{r.tenant.plan}</Badge>
                </TD>
                <TD label="Konuşma" className="text-right tabular-nums">{formatNumber(r.conversations)}</TD>
                <TD label="AI mesajı" className="text-right tabular-nums">{formatNumber(r.messages)}</TD>
                <TD label="Token" className="text-right tabular-nums">
                  {formatNumber(r.inputTokens)} / {formatNumber(r.outputTokens)}
                </TD>
                <TD label="STT" className="text-right tabular-nums">{formatVoiceDuration(r.sttSeconds)}</TD>
                <TD label="TTS" className="text-right tabular-nums">{formatNumber(r.ttsCharacters)}</TD>
                <TD label="Sesli oturum" className="text-right tabular-nums" data-testid="ai-voice-sessions">{formatNumber(v?.sessions ?? 0)}</TD>
                <TD label="Ses dakikası" className="text-right tabular-nums">{(v?.voiceMinutes ?? 0).toLocaleString("tr-TR")} dk</TD>
                <TD label="Yedek oranı" className="text-right tabular-nums" data-testid="ai-fallback-rate">{formatRate(v?.fallbackRate ?? 0)}</TD>
                <TD label="Sağlayıcı hata oranı" className="text-right tabular-nums">{formatRate(v?.providerErrorRate ?? 0)}</TD>
              </TR>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EmptyState icon={Sparkles} title="Bu dönemde AI kullanımı yok" description="İşletmeler sesli asistanı kullandıkça burada görünür." />
      )}
    </>
  );
}
