"use client";

import { Check, Clock, Gift, Globe, Sparkles, MapPin, MessageSquareText, Mic, Navigation, Receipt, Search, ShoppingBag, SlidersHorizontal, Star, Store, UserRound, UtensilsCrossed, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MENU_LOCALE_LABELS } from "@/config/menu";
import { trackMenuEvent } from "@/lib/public-menu/events";
import { LOCALE_BADGES, PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_PARAM, publicStrings, type PublicStrings } from "@/lib/public-menu/i18n";
import { POPULAR_KEY, buildCategoryNav } from "@/lib/public-menu/navigation";
import { EMPTY_FILTERS, filterProducts, hasActiveFilters, type MenuFilters } from "@/lib/public-menu/search";
import type { PublicCategoryView, PublicMenuView, PublicProductView } from "@/lib/public-menu/types";
import { customerStrings } from "@/lib/crm/i18n";
import type { PublicAccount } from "@/lib/crm/types";
import { cn } from "@/lib/utils/cn";
import { contrastRatio } from "@/lib/tables/contrast";
import { displaySerif } from "@/components/public/fonts";
import { ProductCard } from "@/components/public/product-card";
import { ProductImage } from "@/components/public/product-image";
import { AllergenNotice, ProductSheet, type SheetOrdering } from "@/components/public/product-sheet";
import { CartSheet } from "@/components/public/cart/cart-sheet";
import { useCart, useOtherCarts, useRecentOrders } from "@/components/public/cart/use-cart";
import { addLine, cartItemCount, replaceLine, setQuantity, type CartLine } from "@/lib/orders/cart";
import { AI_CTA } from "@/lib/ai/cta";
import type { CartLinePayload, RecommendationBundle } from "@/lib/ai/types";
import { formatMoney } from "@/lib/menu/money";
import { NUMBER_LOCALES } from "@/lib/public-menu/i18n";
import { orderStrings } from "@/lib/public-menu/i18n-order";
import { serviceStrings } from "@/lib/public-menu/i18n-service";
import type { CustomerServiceRequestView } from "@/server/services/service-requests/customer-request.service";
import { ServiceSheet, ServiceStatusChip } from "@/components/public/service/service-sheet";
import { useServiceRequests } from "@/components/public/service/use-service-requests";

/** Sesli asistan paneli tembel yüklenir: AI kapalı işletmelerde ve panel açılmadan önce indirilmez. */
const VoiceAssistant = dynamic(() => import("@/components/public/assistant/voice-assistant"), { ssr: false });
/** Sesten sese garson (tam ekran, yalnızca ses) — AI paketi açıksa menü açılınca gelir. */
const VoiceConcierge = dynamic(() => import("@/components/public/assistant/voice-concierge"), { ssr: false });

/**
 * Müşteri QR menüsü (Sprint 5, YALNIZCA GÖRÜNTÜLEME). Tek istemci bileşeni: sunucunun hazırladığı küçültülmüş
 * görünüm sözleşmesini (PublicMenuView) gösterir; arama/filtre yüklenmiş veride anında çalışır, ağ isteği yapmaz.
 *
 * Yerleşim kapsayıcı sorgularıyla (@container) duyarlıdır — aynı bileşen paneldeki telefon önizlemesinde de
 * gerçek telefon genişliğinde davranır. `scrollRoot` verilirse (önizleme çerçevesi) kaydırma o öğeye göre yapılır.
 */
export function PublicMenu({
  view,
  preview = false,
  scrollRoot,
  serviceRequests = [],
  assistantAvailable = false,
  account = null,
  capabilities = { ordering: true, service: true },
  venue = null,
  realtimeVoice = false,
  notice = null,
}: {
  view: PublicMenuView;
  preview?: boolean;
  scrollRoot?: React.RefObject<HTMLElement | null>;
  /** Masanın güncel servis talepleri (yalnızca gerçek QR bağlamında; sunucudan). */
  serviceRequests?: CustomerServiceRequestView[];
  /** Sesli AI (paket + ayar + sağlayıcı sunucuda doğrulandı); yoksa düğme hiç gösterilmez. */
  assistantAvailable?: boolean;
  /** İsteğe bağlı müşteri hesabı özeti (sunucudan; iletişim bilgisi içermez). Yoksa hiçbir şey gösterilmez. */
  account?: PublicAccount | null;
  /** Paket yetkileri (sunucuda çözülür; Sprint 20): sipariş / servis talebi yoksa sepet ve servis düğmesi hiç gösterilmez. Menü her zaman çalışır. */
  capabilities?: { ordering: boolean; service: boolean };
  /** "İşletme" ve "Google Yorum" sekmeleri (yalnızca gerçek QR bağlamında; sunucudan). */
  venue?: PublicVenue | null;
  /** Sesten sese canlı garson yapılandırılmış mı (sunucuda). Değilse klasik "AI ile Konuş" paneli kullanılır. */
  realtimeVoice?: boolean;
  /** Kapak altında kısa bilgi (ör. işletme ana sayfasında "sipariş için masadaki QR'ı okutun"). */
  notice?: React.ReactNode;
}) {
  const t = publicStrings(view.locale);
  const { theme } = view;
  const [filters, setFilters] = useState<MenuFilters>(EMPTY_FILTERS);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // ─── Sepet (yalnızca gerçek QR masa bağlamında; panel önizlemesinde kapalı) ───
  const ordering = preview ? null : view.ordering;
  const o = orderStrings(view.locale);
  const currency = view.categories.find((c) => c.products.length)?.products[0]?.currency ?? "TRY";
  const money = (minor: number) => formatMoney(minor, currency, NUMBER_LOCALES[view.locale]);
  const cartMeta = useMemo(
    () => (ordering ? { scope: ordering.scope, restaurant: view.restaurant.name, table: view.table?.name ?? "", returnPath: ordering.returnPath } : null),
    [ordering, view.restaurant.name, view.table?.name],
  );
  const { cart, update, read: readCart } = useCart(cartMeta);
  const { carts: otherCarts, clear: clearOtherCart } = useOtherCarts(ordering?.scope ?? null);
  const { orders: recentOrders, remember } = useRecentOrders(ordering?.scope ?? null);
  const [cartOpen, setCartOpen] = useState(false);
  // ─── Servis talepleri (garson / su / peçete / hesap / özel) ───
  const sv = serviceStrings(view.locale);
  const service = useServiceRequests(ordering?.token ?? "", serviceRequests);
  const [serviceOpen, setServiceOpen] = useState(false);
  const latestRequest = service.requests[0] ?? null;
  // ─── Sesli asistan (yalnızca müşterinin dokunuşuyla açılır; mikrofon panel içinde ayrıca dokunuşla) ───
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMounted, setAssistantMounted] = useState(false);
  const showAssistant = !!ordering && assistantAvailable;
  // Sesli garson menüyle birlikte kendiliğinden çalışır; gerçek zamanlı ses yoksa klasik (bas-konuş) panele düşülür.
  const [classicVoice, setClassicVoice] = useState(!realtimeVoice);
  const productByKey = (key: string) => view.categories.flatMap((c) => c.products).find((p) => p.key === key) ?? null;
  const addAssistantLines = (lines: CartLinePayload[]) => {
    update((c) => lines.reduce((acc, line) => addLine(acc, line), c));
    for (const line of lines) trackMenuEvent({ type: "add_to_cart", product: line.product, quantity: line.quantity });
  };
  /** Öneriyi sepete hazırla: yalnızca doğrudan eklenebilen (zorunlu seçimi olmayan) ürünler; fiyat menü görünümünden. */
  const prepareRecommendation = (bundle: RecommendationBundle): number => {
    const lines: CartLinePayload[] = [];
    for (const item of bundle.items) {
      const p = productByKey(item.product);
      if (!item.addable || !p || p.soldOut || p.modifierGroups.some((g) => g.required || g.minSelect > 0) || p.variants.length > 1) continue;
      const variant = p.variants[0] ?? null;
      lines.push({ product: p.key, variant: variant?.ref ?? null, modifiers: [], quantity: item.quantity, note: null, unitPriceMinor: variant?.priceMinor ?? p.basePriceMinor, name: p.name, detail: "" });
    }
    if (lines.length) addAssistantLines(lines);
    return lines.length;
  };
  const [checkTick, setCheckTick] = useState(0);
  const [editLine, setEditLine] = useState<CartLine | null>(null);
  const cartCount = cart ? cartItemCount(cart) : 0;
  const cartTotal = cart ? cart.lines.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0) : 0;
  const [venueOpen, setVenueOpen] = useState(false);
  /** Aynı anda tek açılır sayfa: yenisi açılırken diğerleri kapanır. */
  const closeSheets = () => {
    setCartOpen(false);
    setServiceOpen(false);
    setVenueOpen(false);
    setFiltersOpen(false);
    setOpenKey(null);
  };
  const openCart = () => {
    closeSheets();
    setCheckTick((n) => n + 1);
    setCartOpen(true);
    trackMenuEvent({ type: "view_cart", lines: cart?.lines.length ?? 0 });
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const allProducts = useMemo(() => view.categories.flatMap((c) => c.products), [view.categories]);
  const byKey = useMemo(() => new Map(allProducts.map((p) => [p.key, p])), [allProducts]);
  const featured = useMemo(() => view.featuredKeys.map((k) => byKey.get(k)).filter((p): p is PublicProductView => !!p), [view.featuredKeys, byKey]);
  const filtering = hasActiveFilters(filters);
  const results = useMemo(() => (filtering ? filterProducts(allProducts, filters) : []), [filtering, allProducts, filters]);
  const navItems = useMemo(() => buildCategoryNav(view, t.popular), [view, t.popular]);
  const activeFilterCount = filters.dietary.length + filters.excludeAllergens.length;
  const openProduct = openKey ? (byKey.get(openKey) ?? null) : null;

  // Açılış olayı (analitik temeli — kişisel veri yok).
  useEffect(() => trackMenuEvent({ type: "menu_opened", locale: view.locale }), [view.locale]);

  // Arama kullanımı (metin değil yalnızca uzunluk ve sonuç sayısı), yazmayı bitirince bir kez.
  useEffect(() => {
    if (!filters.query.trim()) return;
    const id = window.setTimeout(() => trackMenuEvent({ type: "search_used", queryLength: filters.query.trim().length, results: results.length }), 800);
    return () => window.clearTimeout(id);
  }, [filters.query, results.length]);

  const stickyHeight = () => stickyRef.current?.getBoundingClientRect().height ?? 0;

  // Kapak görünmez olunca yapışkan başlıkta kimlik satırı belirir.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    // Kapağın çoğu (≥ %65) görünmez olunca: kısa kapakta birkaç piksel kaydırmada iki başlık birden görünmez.
    const io = new IntersectionObserver(([entry]) => setCompact(!entry!.isIntersecting || entry!.intersectionRatio < 0.35), { root: scrollRoot?.current ?? null, threshold: [0, 0.35] });
    io.observe(hero);
    return () => io.disconnect();
  }, [scrollRoot]);

  // Etkin kategori: yapışkan başlığın hemen altındaki (son geçilen) bölüm — kaydırmada, kare başına bir kez hesaplanır.
  useEffect(() => {
    if (filtering) return;
    const container = scrollRoot?.current ?? null;
    const target: HTMLElement | Window = container ?? window;
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = [...document.querySelectorAll<HTMLElement>("[data-pm-section]")];
      const line = (container ? container.getBoundingClientRect().top : 0) + (stickyRef.current?.getBoundingClientRect().height ?? 0) + 16;
      let current: string | null = sections[0]?.getAttribute("data-pm-section") ?? null;
      for (const section of sections) if (section.getBoundingClientRect().top <= line) current = section.getAttribute("data-pm-section");
      setActiveKey(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [filtering, scrollRoot, view.categories]);

  // Arama / filtre başlayınca sonuçlar yapışkan başlığın hemen altından başlasın (aşağıda kaydırılmış sayfada sonuç ve
  // "Temizle" düğmesi alt çubukların arkasında kalmasın).
  // Çizimden SONRA ölçülür (yapışkan başlığın boyu değişebilir; tarayıcının kaydırma sabitlemesi araya girebilir).
  useEffect(() => {
    if (!filtering) return;
    const frame = requestAnimationFrame(() => {
      const heading = document.getElementById("pm-results");
      const sticky = stickyRef.current;
      if (!heading || !sticky) return;
      const container = scrollRoot?.current ?? null;
      const stickyBottom = sticky.getBoundingClientRect().bottom;
      const delta = heading.getBoundingClientRect().top - stickyBottom - 8;
      if (delta < 0) (container ?? window).scrollBy({ top: delta, behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [filtering, filters.query, results.length, scrollRoot]);

  // Seçili kategori çipi her zaman görünür kalsın.
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>(`[data-chip="${activeKey}"]`);
    if (!nav || !chip) return;
    const left = chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2;
    nav.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activeKey]);

  const scrollToSection = (key: string) => {
    const target = document.querySelector<HTMLElement>(`[data-pm-section="${key}"]`);
    if (!target) return;
    const container = scrollRoot?.current ?? null;
    const offset = stickyHeight() + 4;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (container) container.scrollTo({ top: target.offsetTop - offset, behavior });
    else window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior });
    setActiveKey(key);
    target.querySelector<HTMLElement>("h2, h3")?.focus({ preventScroll: true });
    trackMenuEvent({ type: "category_viewed", category: key });
  };

  const sheetOrdering: SheetOrdering | null = ordering && capabilities.ordering
    ? {
        o,
        money,
        edit: editLine && editLine.product === openKey ? { key: editLine.key, variant: editLine.variant, modifiers: editLine.modifiers, quantity: editLine.quantity, note: editLine.note } : null,
        onSubmit: (line, editKey) => {
          update((c) => (editKey ? replaceLine(c, editKey, line) : addLine(c, line)));
          trackMenuEvent({ type: "add_to_cart", product: line.product, quantity: line.quantity });
          if (editKey) {
            setEditLine(null);
            setCheckTick((n) => n + 1);
            setCartOpen(true);
          }
        },
      }
    : null;

  const openDetail = (key: string) => {
    closeSheets();
    setOpenKey(key);
    trackMenuEvent({ type: "product_opened", product: key });
  };

  // Panel önizlemesi panelin kendi <main> öğesinin içinde çizilir — ikinci bir <main> oluşmasın.
  const Main = preview ? "div" : "main";
  // Modern (koyu) düzende başlık / fiyat rengi koyu zeminde okunur olmalı (≥ 4,5:1); değilse sıcak açık ton.
  const modernTitle = contrastRatio(theme.brand, "#0c0a09") >= 4.5 ? theme.brand : contrastRatio(theme.accentText, "#0c0a09") >= 4.5 ? theme.accentText : "#fb923c";
  const cssVars = { "--pm-brand": theme.brand, "--pm-on-brand": theme.onBrand, "--pm-accent": theme.accentText, "--pm-modern-title": modernTitle } as CSSProperties;
  const modern = theme.style === "MODERN";
  const gridClass = theme.style === "VISUAL" ? "grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3" : modern ? "grid gap-3 @2xl:grid-cols-2" : "divide-y divide-stone-200/80";
  const anySheet = cartOpen || serviceOpen || venueOpen || filtersOpen || !!openKey;
  const tabs = tabStrings(view.locale);
  // Sekmeler gerçek menüde her zaman (masa bağlamı yoksa İstek/Öneri gizli); panel önizlemesinde yok.
  const showTabs = !preview;

  const renderProducts = (products: PublicProductView[], priorityFirst = false) => (
    <div className={gridClass}>
      {products.map((p, i) => (
        <ProductCard key={p.key} product={p} style={theme.style} t={t} onOpen={openDetail} priority={priorityFirst && i < 2} />
      ))}
    </div>
  );

  return (
    <div dir={view.direction} lang={view.locale} style={cssVars} className={cn(displaySerif.variable, "@container relative min-h-full font-sans antialiased", modern ? "isolate bg-stone-950 text-stone-100" : "bg-[#faf8f5] text-stone-900")}>
      {/* ── Kapak ─────────────────────────────────────────────── */}
      {modern ? <ModernHero view={view} t={t} heroRef={heroRef} preview={preview} account={preview ? null : account} /> : <Hero view={view} t={t} heroRef={heroRef} preview={preview} account={preview ? null : account} />}
      {notice ? <div className="relative mx-auto mt-3 max-w-3xl px-4">{notice}</div> : null}
      {ordering && otherCarts.length ? (
        <div className="mx-auto mt-4 max-w-3xl px-4">
          {otherCarts.map(({ storageKey, cart: other }) => (
            <div key={storageKey} role="status" data-testid="other-table-cart" className="rounded-2xl bg-amber-50 p-4 text-amber-950 ring-1 ring-amber-200">
              <p className="font-semibold">{o.otherTableTitle}</p>
              <p className="mt-1 text-sm">{o.otherTableHint(other.table, other.restaurant)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={other.returnPath} className="inline-flex min-h-10 items-center rounded-full bg-amber-900 px-4 text-sm font-semibold text-white">
                  {o.returnToTable}
                </a>
                <button type="button" onClick={() => clearOtherCart(storageKey)} className="min-h-10 rounded-full bg-white px-4 text-sm font-semibold ring-1 ring-amber-300">
                  {o.clearOtherCart}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Yapışkan başlık: kimlik (kaydırınca) + arama + filtre + dil + kategoriler ── */}
      <div ref={stickyRef} className={cn("sticky top-0 z-20 backdrop-blur-md", modern ? "bg-stone-950/70 shadow-[0_1px_0_rgb(255_255_255/0.06)]" : "bg-[#faf8f5]/92 shadow-[0_1px_0_rgb(28_25_23/0.06)] supports-[backdrop-filter]:bg-[#faf8f5]/80")}>
        <div className="mx-auto max-w-3xl px-4">
          <div
            aria-hidden={!compact}
            className={cn("grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none", compact ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}
          >
            <div className="flex min-h-0 items-center justify-between gap-3 overflow-hidden">
              <p className="truncate pt-2 text-[0.8125rem] font-semibold">{view.restaurant.name}</p>
              <TableBadge view={view} t={t} preview={preview} small />
            </div>
          </div>
          <div className="flex items-center gap-2 py-2.5">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t.searchLabel}</span>
              <Search aria-hidden="true" className="pointer-events-none absolute start-3.5 top-1/2 size-[1.125rem] -translate-y-1/2 text-stone-500" />
              <input
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                placeholder={t.searchPlaceholder}
                className={cn("h-11 w-full ps-10 pe-10 text-[1rem] shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-accent)] [&::-webkit-search-cancel-button]:hidden", modern ? "rounded-2xl bg-white/10 text-white ring-1 ring-white/10 placeholder:text-stone-400" : "rounded-full bg-white text-stone-900 ring-1 ring-stone-900/10 placeholder:text-stone-500")}
              />
              {filters.query ? (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, query: "" }))}
                  className="absolute end-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100"
                >
                  <X aria-hidden="true" className="size-4" />
                  <span className="sr-only">{t.clearSearch}</span>
                </button>
              ) : null}
            </label>
            {view.filters.dietary.length || view.filters.allergens.length ? (
              <button
                type="button"
                onClick={() => {
                  closeSheets();
                  setFiltersOpen(true);
                }}
                aria-haspopup="dialog"
                className={cn(
                  "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]",
                  modern ? "bg-white/10 text-white ring-white/10" : "bg-white ring-stone-900/10",
                  activeFilterCount > 0 && "ring-2 ring-[var(--pm-accent)]",
                )}
              >
                <SlidersHorizontal aria-hidden="true" className="size-[1.125rem]" />
                <span className="sr-only">
                  {t.filters}
                  {activeFilterCount ? ` (${activeFilterCount})` : ""}
                </span>
                {activeFilterCount ? (
                  <span aria-hidden="true" className="absolute -end-0.5 -top-0.5 inline-flex size-5 items-center justify-center rounded-full bg-[var(--pm-brand)] text-[0.6875rem] font-bold text-[var(--pm-on-brand)]">
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>
            ) : null}
            <LanguageMenu view={view} t={t} dark={modern} />
          </div>
          {!filtering && navItems.length > 1 ? (
            <nav aria-label={t.categories} className="-mx-4">
              <div ref={navRef} className="flex gap-1.5 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {modern ? (
                  <button
                    type="button"
                    data-chip="__all"
                    aria-current={!activeKey || activeKey === navItems[0]?.key ? "true" : undefined}
                    onClick={() => (scrollRoot?.current ?? window).scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" })}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[0.875rem] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]",
                      !activeKey || activeKey === navItems[0]?.key ? "bg-[var(--pm-brand)] text-[var(--pm-on-brand)]" : "bg-white/10 text-stone-100 ring-1 ring-white/10",
                    )}
                  >
                    {tabs.all}
                  </button>
                ) : null}
                {navItems.map((item) => {
                  const active = activeKey === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-chip={item.key}
                      aria-current={active ? "true" : undefined}
                      onClick={() => scrollToSection(item.key)}
                      className={cn(
                        "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[0.875rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]",
                        modern
                          ? active && activeKey !== navItems[0]?.key
                            ? "bg-[var(--pm-brand)] text-[var(--pm-on-brand)]"
                            : "bg-white/10 text-stone-100 ring-1 ring-white/10 hover:bg-white/15"
                          : active
                            ? "bg-[var(--pm-brand)] text-[var(--pm-on-brand)]"
                            : item.child
                              ? "text-stone-600 hover:bg-stone-200/60"
                              : "bg-white text-stone-800 ring-1 ring-stone-900/10 hover:bg-stone-50",
                      )}
                    >
                      {item.name}
                    </button>
                  );
                })}
              </div>
            </nav>
          ) : null}
        </div>
      </div>

      {/* ── İçerik ────────────────────────────────────────────── */}
      <Main className={cn("relative mx-auto max-w-3xl px-4 pt-4", ordering ? (latestRequest ? "pb-44" : "pb-32") : showTabs ? "pb-28" : "pb-10")}>
        {view.categories.length === 0 ? (
          <EmptyBlock title={t.emptyMenu} text={t.emptyMenuHint} />
        ) : filtering ? (
          <section aria-labelledby="pm-results" className="pt-2">
            <h2 id="pm-results" className="mb-1 text-sm font-medium text-stone-500" aria-live="polite">
              {t.results(results.length)}
            </h2>
            {filters.excludeAllergens.length || filters.dietary.length ? <p className="mb-3 text-xs text-stone-500">{t.declaredNote}</p> : null}
            {results.length ? (
              renderProducts(results)
            ) : (
              <EmptyBlock
                title={t.noResults}
                text={t.noResultsHint}
                action={
                  <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="mt-4 inline-flex h-11 items-center rounded-full bg-[var(--pm-brand)] px-5 text-sm font-semibold text-[var(--pm-on-brand)]">
                    {t.clearFilters}
                  </button>
                }
              />
            )}
          </section>
        ) : (
          <>
            {featured.length ? (
              <section data-pm-section={POPULAR_KEY} aria-labelledby="pm-popular" className="scroll-mt-40 pb-6">
                <h2 id="pm-popular" tabIndex={-1} className={sectionTitleClass(theme.style)}>
                  {t.popular}
                </h2>
                <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {featured.map((p) => (
                    <div key={p.key} className="w-[78%] max-w-[20rem] shrink-0 snap-start @2xl:w-[19rem]">
                      <ProductCard product={p} style={modern ? "MODERN" : "VISUAL"} t={t} onOpen={openDetail} />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {view.categories.map((category, i) => (
              <CategorySection key={category.key} category={category} style={theme.style}>
                {category.products.length ? renderProducts(category.products, i === 0 && !featured.length) : null}
              </CategorySection>
            ))}
          </>
        )}

        {theme.show.allergens && view.categories.length ? <AllergenNotice t={t} className="mt-10" /> : null}
        {theme.show.poweredBy ? <MenuCredits t={t} dark={modern} /> : null}
      </Main>

      <ProductSheet
        product={openProduct}
        style={theme.style}
        t={t}
        allergenNoticeVisible={theme.show.allergens}
        ordering={sheetOrdering}
        onClose={() => {
          setOpenKey(null);
          setEditLine(null);
        }}
      />
      {ordering ? (
        <div aria-hidden={anySheet || undefined} className={cn("pointer-events-none fixed inset-x-0 z-30 flex flex-col items-center gap-2 px-4 transition-opacity", showTabs ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]" : "bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]", anySheet && "invisible opacity-0")}>
          {latestRequest ? <ServiceStatusChip s={sv} request={latestRequest} reconnecting={service.streamState === "reconnecting"} /> : null}
          <div className="mx-auto flex w-full max-w-md items-center justify-end gap-2">
            {showAssistant && classicVoice ? (
              <button
                type="button"
                onClick={() => {
                  setAssistantMounted(true);
                  setAssistantOpen(true);
                }}
                aria-haspopup="dialog"
                data-testid="ai-button"
                className={cn(
                  "pointer-events-auto inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-full bg-stone-900 px-4 text-[0.9375rem] font-semibold text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)] focus-visible:ring-offset-2",
                  cartCount > 0 && "w-14 px-0",
                )}
              >
                <Mic aria-hidden="true" className="size-5" />
                <span className={cn(cartCount > 0 && "sr-only")}>{AI_CTA[view.locale]}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {showAssistant && assistantMounted && ordering ? (
        <VoiceAssistant
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          token={ordering.token}
          scope={ordering.scope}
          uiLocale={view.locale}
          menuLocales={view.availableLocales}
          cart={(cart?.lines ?? []).map((l) => ({ key: l.key, selection: { product: l.product, variant: l.variant, modifiers: l.modifiers, quantity: l.quantity, note: l.note } }))}
          recentOrders={recentOrders.map((r) => r.publicId)}
          onAddLines={addAssistantLines}
          onChangeLine={(key, quantity) => update((c) => setQuantity(c, key, quantity))}
          onOpenProduct={(key) => {
            setAssistantOpen(false);
            setOpenKey(key);
          }}
          onOpenCart={() => {
            setAssistantOpen(false);
            openCart();
          }}
          onPrepareRecommendation={prepareRecommendation}
          onServiceResult={service.upsert}
        />
      ) : null}
      {ordering && capabilities.service ? (
        <ServiceSheet
          open={serviceOpen}
          onClose={() => setServiceOpen(false)}
          s={sv}
          token={ordering.token}
          requests={service.requests}
          recentOrders={recentOrders.map((r) => r.publicId)}
          onResult={service.upsert}
          onRefresh={() => void service.refresh()}
        />
      ) : null}
      {ordering && capabilities.ordering ? (
        <CartSheet
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          cart={cart}
          update={update}
          o={o}
          money={money}
          locale={view.locale}
          token={ordering.token}
          tableName={view.table?.name ?? ""}
          remember={remember}
          initialCheck={checkTick}
          onEdit={(line) => {
            setCartOpen(false);
            setEditLine(line);
            setOpenKey(line.product);
          }}
        />
      ) : null}
      {ordering && capabilities.ordering && (cartCount > 0 || recentOrders[0]) ? (
        <div className={cn("pm-modal-hide fixed end-0 top-[58%] z-30 -translate-y-1/2 transition-[opacity,transform] duration-200 motion-reduce:transition-none", anySheet && "pointer-events-none invisible translate-x-full opacity-0")}>
          {cartCount > 0 ? (
            <button
              type="button"
              onClick={openCart}
              aria-haspopup="dialog"
              data-testid="cart-bar"
              className="flex min-h-14 items-center gap-2.5 rounded-s-full bg-[var(--pm-brand)] py-2 pe-3 ps-3.5 text-[var(--pm-on-brand)] shadow-[0_10px_30px_-8px_rgb(0_0_0/0.55)] ring-1 ring-white/15 transition-[padding] hover:pe-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:pe-5"
            >
              <span className="relative">
                <ShoppingBag aria-hidden="true" className="size-6" />
                <span aria-hidden="true" className="absolute -end-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1 text-[0.6875rem] font-bold leading-5 text-stone-900">
                  {cartCount}
                </span>
              </span>
              <span aria-hidden="true" className="flex flex-col items-start leading-tight">
                <span className="hidden text-[0.75rem] font-medium opacity-85 sm:block">{tabs.cart}</span>
                <span className="text-[0.9375rem] font-bold tabular-nums">{money(cartTotal)}</span>
              </span>
              <span className="sr-only">{o.cartBar(cartCount, money(cartTotal))}</span>
            </button>
          ) : recentOrders[0] ? (
            <Link
              href={`${ordering.returnPath}/siparis/${recentOrders[0].publicId}`}
              data-testid="my-orders"
              className="flex min-h-12 items-center gap-2 rounded-s-full bg-white py-2 pe-3 ps-3.5 text-[0.875rem] font-semibold text-stone-900 shadow-[0_10px_30px_-8px_rgb(0_0_0/0.45)] ring-1 ring-stone-900/10 sm:pe-5"
            >
              <Receipt aria-hidden="true" className="size-5 shrink-0" />
              <span aria-hidden="true" className="sm:hidden">{recentOrders[0].number}</span>
              <span className="sr-only sm:not-sr-only">
                {o.myOrders} · {recentOrders[0].number}
              </span>
            </Link>
          ) : null}
        </div>
      ) : null}
      {showTabs ? (
        <BottomTabs
          voice={
            showAssistant && !classicVoice && ordering ? (
              <VoiceConcierge
                token={ordering.token}
                scope={ordering.scope}
                uiLocale={view.locale}
                restaurantName={view.restaurant.name}
                brand={theme.brand}
                readCart={readCart}
                update={update}
                recentOrders={recentOrders.map((r) => r.publicId)}
                remember={remember}
                onServiceResult={service.upsert}
                onFallback={() => setClassicVoice(true)}
              />
            ) : null
          }
          s={tabs}
          hidden={anySheet}
          venue={venue}
          serviceEnabled={!!ordering && capabilities.service}
          serviceActive={service.hasActive}
          onMenu={() => {
            closeSheets();
            (scrollRoot?.current ?? window).scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
          }}
          onService={() => {
            closeSheets();
            setServiceOpen(true);
          }}
          onVenue={() => {
            closeSheets();
            setVenueOpen(true);
          }}
        />
      ) : null}
      {showTabs ? <VenueSheet open={venueOpen} onClose={() => setVenueOpen(false)} view={view} venue={venue} s={tabs} /> : null}
      <FilterSheet open={filtersOpen} view={view} t={t} filters={filters} setFilters={setFilters} count={filterProducts(allProducts, { ...filters, query: filters.query }).length} onClose={() => setFiltersOpen(false)} />
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sectionTitleClass(style: PublicMenuView["theme"]["style"], child = false): string {
  if (style === "MODERN") return child ? "mb-2 mt-1 scroll-mt-40 text-[1.0625rem] font-semibold text-stone-200 focus:outline-none" : "mb-3 scroll-mt-40 text-[1.25rem] font-bold tracking-tight text-[var(--pm-modern-title)] focus:outline-none";
  if (style === "LUXURY") return cn("mb-1 text-center font-[family-name:var(--font-display-serif)] font-medium tracking-tight focus:outline-none", child ? "text-[1.25rem] text-stone-700" : "text-[1.75rem]");
  return cn("mb-3 font-semibold tracking-tight focus:outline-none", child ? "text-[1.0625rem] text-stone-700" : "text-[1.375rem]");
}

function CategorySection({ category, style, children }: { category: PublicCategoryView; style: PublicMenuView["theme"]["style"]; children: React.ReactNode }) {
  const child = category.parentKey !== null;
  const headingId = `pm-cat-${category.key}`;
  const Heading = child ? "h3" : "h2";
  return (
    <section data-pm-section={category.key} aria-labelledby={headingId} className={cn("scroll-mt-40", child ? "pb-6 pt-1" : "pb-8 pt-4", style === "LUXURY" && !child && "pt-8")}>
      {category.imageUrl && !child && style !== "COMPACT" ? (
        <div className="relative mb-4 aspect-[3/1] overflow-hidden rounded-2xl bg-stone-100">
          <ProductImage src={category.imageUrl} alt="" sizes="(min-width: 768px) 768px, 100vw" />
        </div>
      ) : null}
      <Heading id={headingId} tabIndex={-1} className={sectionTitleClass(style, child)}>
        {category.name}
      </Heading>
      {category.description ? <p className={cn("-mt-2 mb-3 text-[0.9375rem] leading-relaxed text-stone-500", style === "LUXURY" && "mt-1 text-center")}>{category.description}</p> : null}
      {style === "LUXURY" && !child ? <div aria-hidden="true" className="mx-auto mb-2 mt-3 h-px w-12 bg-[var(--pm-accent)]" /> : null}
      {children}
    </section>
  );
}

function Hero({ view, t, heroRef, preview, account }: { view: PublicMenuView; t: PublicStrings; heroRef: React.RefObject<HTMLDivElement | null>; preview: boolean; account: PublicAccount | null }) {
  const { theme } = view;
  const [heroMissing, setHeroMissing] = useState(false);
  const [logoMissing, setLogoMissing] = useState(false);
  const hasHero = !!theme.heroImageUrl && !heroMissing;
  const monogram = view.restaurant.name.trim().slice(0, 1).toLocaleUpperCase(view.locale === "tr" ? "tr-TR" : undefined);

  return (
    <header ref={heroRef} className="relative">
      {hasHero ? (
        <div className="relative h-56 overflow-hidden bg-stone-200 @2xl:h-72">
          <ProductImage src={theme.heroImageUrl!} alt="" priority sizes="100vw" onMissing={() => setHeroMissing(true)} />
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-stone-950/70 via-stone-950/10 to-transparent" />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="h-28 @2xl:h-36"
          style={{ background: `radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--pm-brand) 22%, #faf8f5) 0%, #faf8f5 70%)` }}
        />
      )}
      <div className={cn("relative mx-auto max-w-3xl px-4", hasHero ? "-mt-16" : "-mt-14")}>
        <div className="flex items-end gap-3">
          <span className="relative inline-flex size-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-[1.75rem] font-semibold shadow-lg ring-1 ring-black/5">
            {theme.logoUrl && !logoMissing ? (
              <ProductImage src={theme.logoUrl} alt={`${view.restaurant.name}`} priority sizes="72px" className="object-contain p-1.5" onMissing={() => setLogoMissing(true)} />
            ) : (
              <span aria-hidden="true" className="flex size-full items-center justify-center" style={{ backgroundColor: "var(--pm-brand)", color: "var(--pm-on-brand)" }}>
                {monogram}
              </span>
            )}
          </span>
          <div className="mb-1 ms-auto flex flex-col items-end gap-1.5">
            <TableBadge view={view} t={t} preview={preview} />
            <AccountPill account={account} locale={view.locale} />
          </div>
        </div>
        <p className="mt-4 text-[0.8125rem] font-medium uppercase tracking-[0.12em] text-stone-500">{t.welcome}</p>
        <h1 className={cn("mt-1 text-[1.875rem] leading-[1.1] tracking-tight text-balance @2xl:text-[2.5rem]", theme.style === "LUXURY" ? "font-[family-name:var(--font-display-serif)] font-medium" : "font-semibold")}>{view.restaurant.name}</h1>
        {view.branch ? <p className="mt-1.5 text-[0.9375rem] text-stone-600">{view.branch.name}</p> : null}
        {theme.welcomeText ? <p className="mt-3 max-w-xl text-[1rem] leading-relaxed text-stone-700">{theme.welcomeText}</p> : null}
      </div>
    </header>
  );
}

/** Küçük, rahatsız etmeyen hesap / puan bağlantısı. Kimliksiz misafire yalnızca sadakat açıksa "Puan kazan". */
function AccountPill({ account, locale }: { account: PublicAccount | null; locale: string }) {
  if (!account || (!account.identified && !account.loyaltyEnabled)) return null;
  const c = customerStrings(locale);
  const label = account.identified ? (account.points !== null ? c.pointsShort(account.points) : c.account) : c.earnPoints;
  return (
    <Link
      href={account.href}
      data-testid="account-pill"
      data-identified={account.identified ? "1" : "0"}
      className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 px-3 py-1 text-[0.8125rem] font-semibold text-stone-800 shadow-sm ring-1 ring-black/5 hover:bg-white"
    >
      {account.identified ? <UserRound aria-hidden="true" className="size-3.5" /> : <Gift aria-hidden="true" className="size-3.5" />}
      {label}
    </Link>
  );
}

function TableBadge({ view, t, preview, small = false }: { view: PublicMenuView; t: PublicStrings; preview: boolean; small?: boolean }) {
  if (!view.table) {
    return preview ? <span className={cn("rounded-full bg-amber-100 font-semibold text-amber-900", small ? "px-2.5 py-0.5 text-xs" : "px-3.5 py-1.5 text-sm")}>{t.preview}</span> : null;
  }
  return (
    <span data-testid="table-badge" className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold", small ? "px-2.5 py-0.5 text-xs" : "px-3.5 py-1.5 text-sm shadow-sm")} style={{ backgroundColor: "var(--pm-brand)", color: "var(--pm-on-brand)" }}>
      {view.table.name}
      {view.table.area && !small ? <span className="font-normal opacity-80">· {view.table.area}</span> : null}
    </span>
  );
}

function LanguageMenu({ view, t, dark = false }: { view: PublicMenuView; t: PublicStrings; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold shadow-sm ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]", dark ? "bg-white/10 text-white ring-white/10" : "bg-white ring-stone-900/10")}
      >
        <Globe aria-hidden="true" className="size-4" />
        <span>{LOCALE_BADGES[view.locale]}</span>
        <span className="sr-only">— {t.language}</span>
      </button>
      {open ? (
        <ul className="absolute end-0 top-[calc(100%+0.5rem)] z-30 w-44 overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-stone-900/10">
          {view.availableLocales.map((locale) => (
            <li key={locale}>
              <Link
                href={{ query: { [PUBLIC_LOCALE_PARAM]: locale } }}
                replace
                scroll={false}
                hrefLang={locale}
                lang={locale}
                aria-current={locale === view.locale ? "true" : undefined}
                onClick={() => {
                  // Tercih yalnızca bu cihazda, yalnızca dil kodu olarak hatırlanır (izleme yok).
                  document.cookie = `${PUBLIC_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
                  if (locale !== view.locale) trackMenuEvent({ type: "language_changed", from: view.locale, to: locale });
                  setOpen(false);
                }}
                className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-[0.9375rem] hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]"
              >
                <span>{MENU_LOCALE_LABELS[locale]}</span>
                {locale === view.locale ? <Check aria-hidden="true" className="size-4" /> : <span className="text-xs text-stone-400">{LOCALE_BADGES[locale]}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FilterSheet({
  open,
  view,
  t,
  filters,
  setFilters,
  count,
  onClose,
}: {
  open: boolean;
  view: PublicMenuView;
  t: PublicStrings;
  filters: MenuFilters;
  setFilters: (f: MenuFilters) => void;
  count: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      document.querySelectorAll("dialog[open]").forEach((other) => other !== d && (other as HTMLDialogElement).close());
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const toggle = (list: readonly string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-labelledby="pm-filters-title"
      className="m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-[1.75rem] bg-[#faf8f5] p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/45 open:motion-safe:animate-[pm-sheet-in_240ms_cubic-bezier(0.16,1,0.3,1)] sm:m-auto sm:max-w-lg sm:rounded-[1.75rem]"
    >
      <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="pm-filters-title" className="text-[1.25rem] font-semibold tracking-tight">
            {t.filtersTitle}
          </h2>
          <button type="button" onClick={() => ref.current?.close()} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-stone-200/60">
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">{t.close}</span>
          </button>
        </div>
        {view.filters.dietary.length ? (
          <fieldset className="mt-4">
            <legend className="mb-2.5 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-stone-500">{t.dietaryHeading}</legend>
            <div className="flex flex-wrap gap-2">
              {view.filters.dietary.map((d) => (
                <Chip key={d.code} pressed={filters.dietary.includes(d.code)} onClick={() => setFilters({ ...filters, dietary: toggle(filters.dietary, d.code) })} label={d.name} />
              ))}
            </div>
          </fieldset>
        ) : null}
        {view.filters.allergens.length ? (
          <fieldset className="mt-5">
            <legend className="mb-2.5 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-stone-500">{t.allergenHeading}</legend>
            <div className="flex flex-wrap gap-2">
              {view.filters.allergens.map((a) => (
                <Chip key={a.code} pressed={filters.excludeAllergens.includes(a.code)} onClick={() => setFilters({ ...filters, excludeAllergens: toggle(filters.excludeAllergens, a.code) })} label={a.name} />
              ))}
            </div>
          </fieldset>
        ) : null}
        <p className="mt-5 text-[0.8125rem] leading-relaxed text-stone-500">{t.declaredNote}</p>
        <AllergenNotice t={t} className="mt-3" />
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => setFilters({ ...filters, dietary: [], excludeAllergens: [] })} className="h-12 flex-1 rounded-full bg-white text-[0.9375rem] font-semibold ring-1 ring-stone-900/10">
            {t.clearFilters}
          </button>
          <button type="button" onClick={() => ref.current?.close()} className="h-12 flex-[2] rounded-full bg-[var(--pm-brand)] text-[0.9375rem] font-semibold text-[var(--pm-on-brand)]">
            {t.showResults(count)}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Chip({ pressed, onClick, label }: { pressed: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[0.9375rem] font-medium ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]",
        pressed ? "bg-[var(--pm-brand)] text-[var(--pm-on-brand)] ring-transparent" : "bg-white text-stone-800 ring-stone-900/10",
      )}
    >
      {pressed ? <Check aria-hidden="true" className="size-4" /> : null}
      {label}
    </button>
  );
}

function EmptyBlock({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span aria-hidden="true" className="inline-flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/5">
        <Search className="size-6 text-stone-400" />
      </span>
      <p className="mt-4 text-[1.0625rem] font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-[0.9375rem] text-stone-500">{text}</p>
      {action}
    </div>
  );
}

// ─── Alt sekme çubuğu + işletme bilgisi ───────────────────────────────────────

export type PublicVenue = { address: string | null; mapUrl: string | null; reviewUrl: string | null; hours: { weekday: number; opens: number; closes: number }[] };

const TAB_STRINGS = {
  tr: { menu: "Menü", review: "Google Yorum", reviewShort: "Yorum", requestShort: "İstek", cart: "Sepet", request: "İstek/Öneri", venue: "İşletme", all: "Tümü", directions: "Yol tarifi", rate: "Google'da değerlendir", hours: "Çalışma saatleri", closed: "Kapalı", close: "Kapat", address: "Adres" },
  en: { menu: "Menu", review: "Google Review", reviewShort: "Review", requestShort: "Requests", cart: "Cart", request: "Requests", venue: "Venue", all: "All", directions: "Directions", rate: "Review on Google", hours: "Opening hours", closed: "Closed", close: "Close", address: "Address" },
  de: { menu: "Menü", review: "Google-Bewertung", reviewShort: "Bewerten", requestShort: "Wünsche", cart: "Warenkorb", request: "Wünsche", venue: "Lokal", all: "Alle", directions: "Route", rate: "Auf Google bewerten", hours: "Öffnungszeiten", closed: "Geschlossen", close: "Schließen", address: "Adresse" },
  ar: { menu: "القائمة", review: "تقييم Google", reviewShort: "تقييم", requestShort: "طلبات", cart: "السلة", request: "طلبات", venue: "المطعم", all: "الكل", directions: "الاتجاهات", rate: "قيّمنا على Google", hours: "ساعات العمل", closed: "مغلق", close: "إغلاق", address: "العنوان" },
} as const;
type TabStrings = (typeof TAB_STRINGS)[keyof typeof TAB_STRINGS];
function tabStrings(locale: string): TabStrings {
  return TAB_STRINGS[locale as keyof typeof TAB_STRINGS] ?? TAB_STRINGS.tr;
}

/** Mobil alt sekme çubuğu: Menü · Google Yorum · İstek/Öneri · İşletme. Bir sayfa açıkken aşağı kayar. */
const TAB_ITEM =
  "relative flex min-h-[3.75rem] min-w-0 max-w-[4.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 text-[0.6875rem] font-medium text-stone-500 transition-colors hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)] sm:max-w-24";

/**
 * Alt sekme çubuğu. Sesli garson TAM ORTADA (yükseltilmiş düğme); solda Menü + Yorum, sağda İstek + İşletme — iki yan eşit
 * genişlikte olduğundan garson her ekranda ortadadır. Garson yoksa sekmeler ortalanmış tek sıra. Bir sayfa açıkken
 * çubuk aşağı kayar (ses bağlantısı kopmaz; garson bileşeni kalır).
 */
function BottomTabs({
  voice = null,
  s,
  hidden,
  venue,
  serviceEnabled,
  serviceActive,
  onMenu,
  onService,
  onVenue,
}: {
  /** Ortadaki yükseltilmiş sesli garson düğmesi. */
  voice?: React.ReactNode;
  s: TabStrings;
  hidden: boolean;
  venue: PublicVenue | null;
  serviceEnabled: boolean;
  serviceActive: boolean;
  onMenu: () => void;
  onService: () => void;
  onVenue: () => void;
}) {
  const item = TAB_ITEM;
  const menu = (
    <button type="button" onClick={onMenu} aria-current="page" className={cn(item, "text-[var(--pm-accent)] hover:text-[var(--pm-accent)]")}>
      <UtensilsCrossed aria-hidden="true" className="size-5" />
      <span className="font-semibold">{s.menu}</span>
      <span aria-hidden="true" className="absolute bottom-1 h-0.5 w-6 rounded-full bg-[var(--pm-accent)]" />
    </button>
  );
  const review = venue?.reviewUrl ? (
    <a href={venue.reviewUrl} target="_blank" rel="noopener noreferrer" className={item} data-testid="tab-review">
      <Star aria-hidden="true" className="size-5" />
      <span className="max-w-full truncate">{voice ? s.reviewShort : s.review}</span>
    </a>
  ) : null;
  const request = serviceEnabled ? (
    <button type="button" onClick={onService} aria-haspopup="dialog" className={item} data-testid="service-button">
      <MessageSquareText aria-hidden="true" className="size-5" />
      <span className="max-w-full truncate">{voice ? s.requestShort : s.request}</span>
      {serviceActive ? <span aria-hidden="true" className="absolute end-[calc(50%-1.1rem)] top-2.5 size-2 rounded-full bg-emerald-500 ring-2 ring-white" /> : null}
    </button>
  ) : null;
  const venueTab = (
    <button type="button" onClick={onVenue} aria-haspopup="dialog" className={item} data-testid="tab-venue">
      <Store aria-hidden="true" className="size-5" />
      <span>{s.venue}</span>
    </button>
  );
  return (
    <nav
      aria-label={s.menu}
      aria-hidden={hidden || undefined}
      data-testid="bottom-tabs"
      className={cn(
        "pm-modal-hide fixed inset-x-0 bottom-0 z-30 rounded-t-[1.5rem] bg-white px-2 pb-[env(safe-area-inset-bottom)] pt-1 text-stone-900 shadow-[0_-8px_30px_-12px_rgb(0_0_0/0.35)] transition-transform duration-200 motion-reduce:transition-none",
        hidden && "invisible translate-y-full",
      )}
    >
      {voice ? (
        <div className="mx-auto flex max-w-xl items-stretch">
          <div className="flex flex-1 justify-end">
            {menu}
            {review}
          </div>
          <div className="flex w-[5.5rem] shrink-0 justify-center">{voice}</div>
          <div className="flex flex-1 justify-start">
            {request}
            {venueTab}
          </div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-xl items-stretch justify-center">
          {menu}
          {review}
          {request}
          {venueTab}
        </div>
      )}
    </nav>
  );
}

function VenueSheet({ open, onClose, view, venue, s }: { open: boolean; onClose: () => void; view: PublicMenuView; venue: PublicVenue | null; s: TabStrings }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      document.querySelectorAll("dialog[open]").forEach((other) => other !== d && (other as HTMLDialogElement).close());
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  // Gün adları yalnızca açıkken (istemcide) üretilir → sunucu / tarayıcı Intl farkı hidrasyon hatası yapmaz.
  const dayName = (weekday: number) => new Intl.DateTimeFormat(view.locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));
  const days = [1, 2, 3, 4, 5, 6, 7];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-labelledby="pm-venue-title"
      data-testid="venue-sheet"
      className="m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-[1.75rem] bg-[#faf8f5] p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/45 open:motion-safe:animate-[pm-sheet-in_240ms_cubic-bezier(0.16,1,0.3,1)] sm:m-auto sm:max-w-lg sm:rounded-[1.75rem]"
    >
      {open ? (
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {view.theme.logoUrl ? (
                <span className="relative size-14 shrink-0 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
                  <ProductImage src={view.theme.logoUrl} alt="" sizes="56px" className="object-contain p-1" />
                </span>
              ) : null}
              <div className="min-w-0">
                <h2 id="pm-venue-title" className="text-[1.25rem] font-semibold tracking-tight">
                  {view.restaurant.name}
                </h2>
                {view.branch ? <p className="text-sm text-stone-500">{view.branch.name}</p> : null}
              </div>
            </div>
            <button type="button" onClick={() => ref.current?.close()} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-stone-200/60">
              <X aria-hidden="true" className="size-5" />
              <span className="sr-only">{s.close}</span>
            </button>
          </div>
          {venue?.address ? (
            <p className="mt-5 flex items-start gap-2.5 text-[0.9375rem] leading-relaxed text-stone-700">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-stone-400" />
              <span>
                <span className="sr-only">{s.address}: </span>
                {venue.address}
              </span>
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {venue?.mapUrl ? (
              <a href={venue.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--pm-brand)] px-4 text-sm font-semibold text-[var(--pm-on-brand)]">
                <Navigation aria-hidden="true" className="size-4" /> {s.directions}
              </a>
            ) : null}
            {venue?.reviewUrl ? (
              <a href={venue.reviewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold ring-1 ring-stone-900/10">
                <Star aria-hidden="true" className="size-4" /> {s.rate}
              </a>
            ) : null}
          </div>
          {venue?.hours.length ? (
            <section className="mt-6" aria-labelledby="pm-venue-hours">
              <h3 id="pm-venue-hours" className="mb-2 flex items-center gap-2 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-stone-500">
                <Clock aria-hidden="true" className="size-4" /> {s.hours}
              </h3>
              <dl className="divide-y divide-stone-200/80 rounded-2xl bg-white px-4 ring-1 ring-stone-900/5">
                {days.map((d) => {
                  const slots = venue.hours.filter((h) => h.weekday === d);
                  return (
                    <div key={d} className="flex items-center justify-between gap-3 py-2.5 text-[0.9375rem]">
                      <dt className="capitalize text-stone-600">{dayName(d)}</dt>
                      <dd className="font-medium tabular-nums">{slots.length ? slots.map((h) => `${fmt(h.opens)}–${fmt(h.closes)}`).join(", ") : s.closed}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** Modern (koyu) düzen başlığı: kapak görseli tüm sayfanın bulanık arka planı olur; üstte logo + ad + masa. */
function ModernHero({ view, t, heroRef, preview, account }: { view: PublicMenuView; t: PublicStrings; heroRef: React.RefObject<HTMLDivElement | null>; preview: boolean; account: PublicAccount | null }) {
  const { theme } = view;
  const [logoMissing, setLogoMissing] = useState(false);
  // Kapak dosyası açılamazsa (silinmiş / taşınmış) kırık görsel yerine sade başlık; hidrasyondan önceki hata da yakalanır.
  const [heroMissing, setHeroMissing] = useState(false);
  const heroImgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = heroImgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setHeroMissing(true);
  }, [theme.heroImageUrl]);
  const showBanner = !!theme.heroImageUrl && !heroMissing;
  const monogram = view.restaurant.name.trim().slice(0, 1).toLocaleUpperCase(view.locale === "tr" ? "tr-TR" : undefined);
  return (
    <>
      {showBanner ? (
        <div aria-hidden="true" className={cn("pointer-events-none inset-0 -z-10 overflow-hidden", preview ? "absolute" : "fixed")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={theme.heroImageUrl ?? undefined} alt="" className="size-full scale-110 object-cover opacity-45 blur-[6px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-stone-950/55 via-stone-950/75 to-stone-950/95" />
        </div>
      ) : null}
      <header ref={heroRef} className="relative mx-auto max-w-3xl px-4 pb-1 pt-[max(1rem,env(safe-area-inset-top))]">
        {showBanner ? (
          // Kapak görseli koyu düzende de NET bir afiş olarak görünür; kimlik satırı afişin altına bindirilir.
          <div data-testid="modern-banner" className="relative aspect-[16/9] w-full overflow-hidden rounded-[1.75rem] shadow-[0_20px_40px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/10 sm:aspect-[21/9]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={heroImgRef} src={theme.heroImageUrl ?? undefined} alt="" onError={() => setHeroMissing(true)} className="absolute inset-0 size-full object-cover" />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/25 to-stone-950/10" />
            <div className="absolute end-3 top-3 flex flex-col items-end gap-1.5">
              <TableBadge view={view} t={t} preview={preview} small />
              <AccountPill account={account} locale={view.locale} />
            </div>
            <div className="absolute inset-x-3 bottom-3 flex items-center gap-3">
              <span className="relative inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-xl font-semibold shadow-lg ring-2 ring-white/30">
                {theme.logoUrl && !logoMissing ? (
                  <ProductImage src={theme.logoUrl} alt={view.restaurant.name} priority sizes="48px" className="object-contain p-1" onMissing={() => setLogoMissing(true)} />
                ) : (
                  <span aria-hidden="true" className="flex size-full items-center justify-center" style={{ backgroundColor: "var(--pm-brand)", color: "var(--pm-on-brand)" }}>
                    {monogram}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1 drop-shadow-[0_1px_6px_rgb(0_0_0/0.6)]">
                <h1 className="truncate text-[1.375rem] font-bold leading-tight tracking-tight text-white">{view.restaurant.name}</h1>
                {theme.welcomeText ? <p className="line-clamp-2 text-[0.8125rem] text-stone-200">{theme.welcomeText}</p> : view.branch ? <p className="truncate text-[0.8125rem] text-stone-200">{view.branch.name}</p> : null}
              </div>
            </div>
          </div>
        ) : (
        <div className="flex items-center gap-3">
          <span className="relative inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-xl font-semibold shadow-lg ring-2 ring-white/20">
            {theme.logoUrl && !logoMissing ? (
              <ProductImage src={theme.logoUrl} alt={view.restaurant.name} priority sizes="48px" className="object-contain p-1" onMissing={() => setLogoMissing(true)} />
            ) : (
              <span aria-hidden="true" className="flex size-full items-center justify-center" style={{ backgroundColor: "var(--pm-brand)", color: "var(--pm-on-brand)" }}>
                {monogram}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[1.25rem] font-bold leading-tight tracking-tight text-white">{view.restaurant.name}</h1>
            {theme.welcomeText ? <p className="truncate text-[0.8125rem] text-stone-300">{theme.welcomeText}</p> : view.branch ? <p className="truncate text-[0.8125rem] text-stone-300">{view.branch.name}</p> : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <TableBadge view={view} t={t} preview={preview} small />
            <AccountPill account={account} locale={view.locale} />
          </div>
        </div>
        )}
      </header>
    </>
  );
}

/** Menü altı imza kartı: cam kart, akan gradyan yazı, parıltı + ışık süzmesi, kaydırınca beliren giriş (hareket azaltmada durağan). */
const VENDOR = "3Y Tasarım & Yazılım Hizmetleri";
function MenuCredits({ t, dark }: { t: PublicStrings; dark: boolean }) {
  const [before, after] = t.madeBy.includes(VENDOR) ? t.madeBy.split(VENDOR) : [t.madeBy, null];
  return (
    <footer data-testid="menu-credits" className="pm-credit-reveal mt-10 flex justify-center">
      <div
        className={cn(
          "relative isolate inline-flex max-w-full flex-col items-center gap-1 overflow-hidden rounded-2xl px-5 py-3 text-center ring-1 backdrop-blur-md",
          dark ? "bg-white/[0.05] text-stone-400 ring-white/10 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.6)]" : "bg-white/80 text-stone-500 ring-stone-900/5 shadow-sm",
        )}
      >
        <span aria-hidden="true" className="pm-credit-sheen pointer-events-none absolute inset-y-0 -left-1/2 -z-10 w-1/2" />
        <p className="flex items-center gap-1.5 text-[0.75rem] font-medium">
          <Sparkles aria-hidden="true" className="pm-credit-spark size-3.5 text-[var(--pm-modern-title)]" />
          <span className="pm-credit-gradient bg-clip-text font-semibold tracking-wide text-transparent">{t.poweredBy}</span>
        </p>
        <p className="text-[0.6875rem] leading-relaxed">
          {before}
          {after !== null ? <strong className={cn("font-semibold", dark ? "text-stone-200" : "text-stone-800")}>{VENDOR}</strong> : null}
          {after}
        </p>
      </div>
    </footer>
  );
}
