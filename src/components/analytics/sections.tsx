import type { AnalyticsLabels } from "@/lib/analytics/labels";
import { formatMoney } from "@/lib/menu/money";
import { formatDurationShort } from "@/lib/service-requests/timing";
import { formatNumber } from "@/lib/utils/format";
import type { AiData, OperationsData, OverviewData, ProductsData, ServiceData, TablesData } from "@/server/analytics/dashboard.service";
import type { DurationStats } from "@/server/analytics/kds.analytics";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarList, ColumnChart, EmptyNote, Heatmap, KpiCard, Panel, StatGrid } from "@/components/analytics/charts";

/** Analitik bölüm görünümleri (sunucu bileşenleri; DTO'dan yalnızca biçimlendirme). */
type Common = { labels: AnalyticsLabels; currency: string; granularity: "hour" | "day" };

const pct = (v: number | null) => (v === null ? "—" : `%${(Math.round(v * 1000) / 10).toLocaleString("tr-TR")}`);
const dur = (s: DurationStats) => formatDurationShort(s.avgMs);

function bucketLabel(key: string, granularity: "hour" | "day") {
  if (granularity === "hour") return `${key.slice(11, 13)}:00`;
  return `${key.slice(8, 10)}.${key.slice(5, 7)}`;
}

export function OverviewSection({ data, labels: L, currency, granularity }: Common & { data: OverviewData }) {
  const money = (m: number) => formatMoney(m, currency);
  const k = data.kpis;
  const p = data.previous;
  const prev = (v: string) => `${L.previous}: ${v}`;
  const empty = k.salesOrders === 0 && data.funnel.submitted === 0;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" data-testid="analytics-kpis">
        <KpiCard testId="kpi-sales" label={L.kpi.sales} value={money(k.salesMinor)} comparison={data.comparisons.sales} previous={prev(money(p.salesMinor))} lowDataText={L.lowData} />
        <KpiCard testId="kpi-orders" label={L.kpi.orders} value={formatNumber(k.salesOrders)} comparison={data.comparisons.orders} previous={prev(formatNumber(p.salesOrders))} lowDataText={L.lowData} />
        <KpiCard testId="kpi-average" label={L.kpi.average} value={data.averageMinor === null ? "—" : money(data.averageMinor)} comparison={data.comparisons.average} previous={data.previousAverageMinor === null ? null : prev(money(data.previousAverageMinor))} lowDataText={L.lowData} />
        <KpiCard testId="kpi-items" label={L.kpi.items} value={formatNumber(k.itemsSold)} comparison={data.comparisons.items} lowDataText={L.lowData} />
        <KpiCard testId="kpi-tables" label={L.kpi.tables} value={formatNumber(k.activeTables)} comparison={data.comparisons.tables} lowDataText={L.lowData} />
        <KpiCard testId="kpi-prep" label={L.kpi.prep} value={dur(data.preparation)} hint={data.preparation.medianMs !== null ? `${L.ops.median}: ${formatDurationShort(data.preparation.medianMs)}` : undefined} lowDataText={L.lowData} />
        <KpiCard testId="kpi-response" label={L.kpi.response} value={dur(data.serviceResponse)} hint={data.serviceResponse.medianMs !== null ? `${L.ops.median}: ${formatDurationShort(data.serviceResponse.medianMs)}` : undefined} lowDataText={L.lowData} />
      </div>
      <p className="text-[0.8125rem] text-fg-subtle" data-testid="analytics-sales-definition">
        {L.salesDefinition}
        {k.otherCurrencyOrders ? ` ${L.otherCurrency(k.otherCurrencyOrders)}` : ""}
      </p>

      {empty ? (
        <EmptyNote>{L.notEnoughData}</EmptyNote>
      ) : (
        <>
          <Panel title={L.trendTitle(granularity === "hour")} testId="analytics-trend">
            <ColumnChart
              testId="analytics-trend-chart"
              ariaLabel={`${L.trendTitle(granularity === "hour")}: ${money(k.salesMinor)}, ${formatNumber(k.salesOrders)} ${L.ordersUnit}`}
              tableLabel={L.showTable}
              valueHeader={L.kpi.sales}
              data={data.trend.map((b) => ({ key: b.key, label: bucketLabel(b.key, granularity), value: b.salesMinor, display: money(b.salesMinor), secondary: `${formatNumber(b.orders)} ${L.ordersUnit}` }))}
            />
          </Panel>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={L.funnelTitle} description={`${L.acceptanceRate}: ${pct(data.acceptanceRate)} · ${L.rejectionRate}: ${pct(data.rejectionRate)}`} testId="analytics-funnel">
              <BarList
                emptyText={L.notEnoughData}
                items={(["submitted", "pending", "accepted", "rejected", "preparing", "ready", "served", "cancelled"] as const).map((s) => ({ key: s, label: L.funnel[s], value: data.funnel[s], display: formatNumber(data.funnel[s]) }))}
                testId="funnel"
              />
            </Panel>
            <Panel title={L.heatmapTitle} testId="analytics-heatmap">
              {data.heatmap ? <Heatmap cells={data.heatmap.map((c) => ({ weekday: c.weekday, hour: c.hour, value: c.orders }))} weekdays={L.weekdays} ariaLabel={L.heatmapTitle} formatValue={(v) => `${formatNumber(v)} ${L.ordersUnit}`} /> : <EmptyNote>{L.heatmapEmpty}</EmptyNote>}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

export function ProductsSection({ data, labels: L, currency }: Common & { data: ProductsData }) {
  const P = L.products;
  const money = (m: number) => formatMoney(m, currency);
  if (!data.products.length) return <EmptyNote>{L.notEnoughData}</EmptyNote>;
  return (
    <div className="grid gap-6">
      <Panel title={P.title} description={`${P.conversionUnavailable} ${P.soldOutUnavailable}`} testId="analytics-products">
        <Table>
          <THead>
            <TR>
              <TH>#</TH>
              <TH>{L.tabs.products}</TH>
              <TH className="text-right">{P.quantity}</TH>
              <TH className="text-right">{P.orders}</TH>
              <TH className="text-right">{P.contribution}</TH>
              <TH className="text-right">{P.avgUnit}</TH>
              <TH className="text-right">{P.share}</TH>
            </TR>
          </THead>
          <TBody>
            {data.products.slice(0, 50).map((p, i) => (
              <TR key={p.key} data-testid="product-row" data-product={p.name}>
                <TD label="#" className="tabular-nums">{i + 1}</TD>
                <TD label={L.tabs.products} className="font-medium text-fg">
                  {p.name}{" "}
                  {p.deleted ? <Badge>{P.deleted}</Badge> : p.archived ? <Badge>{P.archived}</Badge> : null}
                  {p.formerName ? <span className="block text-[0.75rem] font-normal text-fg-subtle">{`${P.formerly}: ${p.formerName}`}</span> : null}
                </TD>
                <TD label={P.quantity} className="text-right tabular-nums" data-testid="product-qty">{formatNumber(p.quantity)}</TD>
                <TD label={P.orders} className="text-right tabular-nums">{formatNumber(p.orders)}</TD>
                <TD label={P.contribution} className="text-right tabular-nums">{money(p.totalMinor)}</TD>
                <TD label={P.avgUnit} className="text-right tabular-nums">{money(p.avgUnitMinor)}</TD>
                <TD label={P.share} className="text-right tabular-nums">{pct(data.totalQuantity ? p.quantity / data.totalQuantity : null)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel title={P.quadrants} description={P.quadrantNote} testId="analytics-quadrants">
        {data.quadrants ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(P.quadrantNames) as (keyof typeof P.quadrantNames)[]).map((q) => (
              <div key={q} className="rounded-md border border-border p-3">
                <h3 className="text-sm font-semibold text-fg">{P.quadrantNames[q]}</h3>
                <ul className="mt-2 grid gap-1 text-sm text-fg-muted">
                  {data.quadrants![q].length ? data.quadrants![q].slice(0, 6).map((p) => <li key={p.key}>{`${p.name} — ${formatNumber(p.quantity)} · ${money(p.avgUnitMinor)}`}</li>) : <li>—</li>}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <EmptyNote>{L.notEnoughData}</EmptyNote>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={P.variants} testId="analytics-variants">
          {data.variants.length ? (
            <ul className="grid gap-4">
              {data.variants.slice(0, 10).map((g) => (
                <li key={g.productKey}>
                  <h3 className="mb-2 text-sm font-semibold text-fg">{g.productName}</h3>
                  <BarList emptyText={L.notEnoughData} items={g.variants.map((v) => ({ key: v.variant, label: v.variant, value: v.quantity, display: `${formatNumber(v.quantity)} · ${money(v.totalMinor)}` }))} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>{L.notEnoughData}</EmptyNote>
          )}
        </Panel>
        <Panel title={P.modifiers} description={P.modifierNote} testId="analytics-modifiers">
          <BarList emptyText={L.notEnoughData} items={data.modifiers.slice(0, 15).map((m) => ({ key: m.key, label: `${m.modifier} (${m.group})`, value: m.selections, display: formatNumber(m.selections) }))} />
        </Panel>
      </div>

      <Panel title={P.categories} description={P.categoryNote} testId="analytics-categories">
        <BarList emptyText={L.notEnoughData} items={data.categories.map((c) => ({ key: c.name ?? "_unknown", label: c.name ?? P.unknownCategory, value: c.totalMinor, display: `${money(c.totalMinor)} · ${formatNumber(c.quantity)}` }))} />
      </Panel>
    </div>
  );
}

export function TablesSection({ data, labels: L, currency }: Common & { data: TablesData }) {
  const T = L.tables;
  const money = (m: number) => formatMoney(m, currency);
  if (!data.tables.length && !data.areas.length) return <EmptyNote>{L.notEnoughData}</EmptyNote>;
  return (
    <div className="grid gap-6">
      <Panel title={T.areas} testId="analytics-areas">
        <BarList
          testId="area"
          emptyText={L.notEnoughData}
          items={data.areas.map((a) => ({ key: a.areaName ?? "_none", label: a.areaName ?? T.noArea, value: a.totalMinor, display: money(a.totalMinor), extra: `${formatNumber(a.orders)} ${L.ordersUnit} · ${T.activeTables}: ${formatNumber(a.activeTables)} · ${T.requests}: ${formatNumber(a.serviceRequests)}` }))}
        />
      </Panel>
      <Panel title={T.title} description={T.scansNote} testId="analytics-tables">
        <Table>
          <THead>
            <TR>
              <TH>{T.table}</TH>
              <TH>{T.area}</TH>
              <TH className="text-right">{T.orders}</TH>
              <TH className="text-right">{T.total}</TH>
              <TH className="text-right">{T.average}</TH>
              <TH className="text-right">{T.requests}</TH>
              <TH className="text-right">{T.scans}</TH>
            </TR>
          </THead>
          <TBody>
            {data.tables.map((t) => (
              <TR key={t.tableId} data-testid="table-row" data-table={t.name}>
                <TD label={T.table} className="font-medium text-fg">
                  {t.name}
                  {t.formerName ? <span className="block text-[0.75rem] font-normal text-fg-subtle">{`${T.formerly}: ${t.formerName}`}</span> : null}
                </TD>
                <TD label={T.area}>{t.areaName ?? T.noArea}</TD>
                <TD label={T.orders} className="text-right tabular-nums">{formatNumber(t.orders)}</TD>
                <TD label={T.total} className="text-right tabular-nums" data-testid="table-total">{money(t.totalMinor)}</TD>
                <TD label={T.average} className="text-right tabular-nums">{t.avgMinor === null ? "—" : money(t.avgMinor)}</TD>
                <TD label={T.requests} className="text-right tabular-nums">{formatNumber(t.serviceRequests)}</TD>
                <TD label={T.scans} className="text-right tabular-nums">{formatNumber(t.qrScansAllTime)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>
    </div>
  );
}

function DurationBlock({ title, stats, labels: L, testId }: { title: string; stats: DurationStats; labels: AnalyticsLabels; testId?: string }) {
  return (
    <div className="rounded-md border border-border p-4" data-testid={testId}>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {stats.count ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-[0.75rem] text-fg-subtle">{L.ops.average}</dt>
            <dd className="font-semibold tabular-nums text-fg" data-testid={testId ? `${testId}-avg` : undefined}>{formatDurationShort(stats.avgMs)}</dd>
          </div>
          <div>
            <dt className="text-[0.75rem] text-fg-subtle">{L.ops.median}</dt>
            <dd className="font-semibold tabular-nums text-fg" data-testid={testId ? `${testId}-median` : undefined}>{formatDurationShort(stats.medianMs)}</dd>
          </div>
          <div>
            <dt className="text-[0.75rem] text-fg-subtle">{L.ops.p90}</dt>
            <dd className="font-semibold tabular-nums text-fg">{stats.p90Ms === null ? "—" : formatDurationShort(stats.p90Ms)}</dd>
          </div>
          <p className="col-span-3 text-[0.75rem] text-fg-subtle">{`${formatNumber(stats.count)} ${L.ops.samples}`}</p>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-fg-subtle">{L.notEnoughData}</p>
      )}
    </div>
  );
}

export function OperationsSection({ data, labels: L }: Common & { data: OperationsData }) {
  const O = L.ops;
  return (
    <div className="grid gap-6">
      <Panel title={O.title} description={O.staffNote} testId="analytics-ops">
        <div className="grid gap-3 md:grid-cols-3">
          <DurationBlock title={O.acceptance} stats={data.timings.acceptance} labels={L} testId="ops-acceptance" />
          <DurationBlock title={O.preparation} stats={data.timings.preparation} labels={L} testId="ops-preparation" />
          <DurationBlock title={O.readyToServed} stats={data.timings.readyToServed} labels={L} testId="ops-served" />
        </div>
      </Panel>
      <Panel title={O.stations} testId="analytics-stations">
        {data.stations.length ? (
          <Table>
            <THead>
              <TR>
                <TH>{O.station}</TH>
                <TH className="text-right">{O.tickets}</TH>
                <TH className="text-right">{O.average}</TH>
                <TH className="text-right">{O.median}</TH>
                <TH className="text-right">{O.p90}</TH>
                <TH className="text-right">{O.wait}</TH>
              </TR>
            </THead>
            <TBody>
              {data.stations.map((s) => (
                <TR key={s.stationName} data-testid="station-row" data-station={s.stationName}>
                  <TD label={O.station} className="font-medium text-fg">{s.stationName}</TD>
                  <TD label={O.tickets} className="text-right tabular-nums">{formatNumber(s.tickets)}</TD>
                  <TD label={O.average} className="text-right tabular-nums" data-testid="station-avg">{formatDurationShort(s.prep.avgMs)}</TD>
                  <TD label={O.median} className="text-right tabular-nums">{formatDurationShort(s.prep.medianMs)}</TD>
                  <TD label={O.p90} className="text-right tabular-nums">{s.prep.p90Ms === null ? "—" : formatDurationShort(s.prep.p90Ms)}</TD>
                  <TD label={O.wait} className="text-right tabular-nums">{formatDurationShort(s.waitAvgMs)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyNote>{L.notEnoughData}</EmptyNote>
        )}
      </Panel>
    </div>
  );
}

export function ServiceSection({ data, labels: L }: Common & { data: ServiceData }) {
  const S = L.service;
  const s = data.summary;
  if (!s.total) return <EmptyNote>{L.notEnoughData}</EmptyNote>;
  return (
    <div className="grid gap-6">
      <Panel title={S.title} description={S.staffNote} testId="analytics-service">
        <StatGrid
          items={[
            { label: S.total, value: formatNumber(s.total), testId: "service-total" },
            { label: S.completed, value: formatNumber(s.completed) },
            { label: S.cancelled, value: formatNumber(s.cancelled) },
            { label: `${S.response} (${L.ops.median})`, value: formatDurationShort(s.response.medianMs), testId: "service-response-median" },
          ]}
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <DurationBlock title={S.response} stats={s.response} labels={L} testId="service-response" />
          <DurationBlock title={S.completion} stats={s.completion} labels={L} testId="service-completion" />
        </div>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={S.byType} testId="analytics-service-types">
          <BarList testId="service-type" emptyText={L.notEnoughData} items={s.byType.map((t) => ({ key: t.type, label: S.types[t.type] ?? t.type, value: t.count, display: formatNumber(t.count) }))} />
        </Panel>
        <Panel title={S.byArea}>
          <BarList emptyText={L.notEnoughData} items={data.byArea.map((a) => ({ key: a.area ?? "_none", label: a.area ?? L.tables.noArea, value: a.count, display: formatNumber(a.count) }))} />
        </Panel>
      </div>
      <Panel title={S.byHour} testId="analytics-service-hours">
        <ColumnChart tableLabel={L.showTable} valueHeader={S.total} ariaLabel={S.byHour} data={data.byHour.map((h) => ({ key: String(h.hour), label: `${String(h.hour).padStart(2, "0")}:00`, value: h.count, display: formatNumber(h.count) }))} />
      </Panel>
      <Panel title={S.byTable}>
        <BarList emptyText={L.notEnoughData} items={data.byTable.slice(0, 15).map((t) => ({ key: t.tableId, label: t.tableName, value: t.count, display: formatNumber(t.count) }))} />
      </Panel>
    </div>
  );
}

const LANG_NAMES: Record<string, string> = { tr: "Türkçe", en: "English", de: "Deutsch", ar: "العربية", ru: "Русский" };

export function AiSection({ data, labels: L }: Common & { data: AiData }) {
  const A = L.ai;
  if (!data.conversations && !data.turns) return <EmptyNote>{L.notEnoughData}</EmptyNote>;
  const minutes = Math.floor(data.voiceSeconds / 60);
  return (
    <div className="grid gap-6">
      <Panel title={A.title} description={`${A.privacy} ${A.correlationUnavailable}`} testId="analytics-ai">
        <StatGrid
          items={[
            { label: A.conversations, value: formatNumber(data.conversations), testId: "ai-conversations" },
            { label: A.turns, value: formatNumber(data.turns), testId: "ai-turns" },
            { label: A.voiceMinutes, value: `${minutes} dk ${String(data.voiceSeconds % 60).padStart(2, "0")} sn`, testId: "ai-voice" },
            { label: A.fallbackRate, value: pct(data.fallbackRate), testId: "ai-fallback" },
            { label: A.interruptions, value: formatNumber(data.interruptions) },
            { label: A.reconnects, value: formatNumber(data.reconnects) },
            { label: A.failed, value: formatNumber(data.failedTurns) },
            { label: A.productCards, value: formatNumber(data.productCardsShown) },
          ]}
        />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={A.convLanguages} testId="analytics-ai-languages">
          <BarList testId="ai-language" emptyText={L.notEnoughData} items={data.conversationLanguages.map((l) => ({ key: l.language, label: `${LANG_NAMES[l.language] ?? l.language} (${l.language.toUpperCase()})`, value: l.count, display: formatNumber(l.count) }))} />
        </Panel>
        <Panel title={A.msgLanguages}>
          <BarList emptyText={L.notEnoughData} items={data.messageLanguages.map((l) => ({ key: l.language, label: `${LANG_NAMES[l.language] ?? l.language} (${l.language.toUpperCase()})`, value: l.count, display: formatNumber(l.count) }))} />
        </Panel>
        <Panel title={A.actions}>
          <BarList emptyText={L.notEnoughData} items={[...data.actions.map((a) => ({ key: a.kind, label: A.actionKinds[a.kind] ?? a.kind, value: a.count, display: formatNumber(a.count) })), ...(data.recommendations ? [{ key: "_rec", label: A.recommendations, value: data.recommendations, display: formatNumber(data.recommendations) }] : [])]} />
        </Panel>
      </div>
    </div>
  );
}
