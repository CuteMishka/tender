import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ElementType } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Banknote, BriefcaseBusiness, CheckCircle2, ExternalLink, FileText, Filter, Search, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import {
  fetchTendersList,
  formatTenderAmount,
  formatDate,
  getLocalApiBase,
  getTenderStatus,
  getViewedTenders,
  getAllViewInfo,
  removeTenderFromSuitable,
  sanitizeApiText,
  tenderCompanyName,
  tenderSourceLabel,
  type TendersListResponse,
  type TenderItem,
  type TenderViewInfo,
} from "@/lib/tenders-api";
import { apiFetch } from "@/lib/api-client";

type TendersSearch = { page: number; limit: number };

const PAGE_LIMIT_OPTIONS = [10, 20, 50] as const;

function normalizePageLimit(value: unknown): number {
  const limit = Number(value);
  return PAGE_LIMIT_OPTIONS.includes(limit as (typeof PAGE_LIMIT_OPTIONS)[number]) ? limit : 10;
}

function pageFromLocation(location: { search: unknown; searchStr?: string }): number {
  const s = location.search;
  if (typeof s === "object" && s !== null && "page" in s) {
    const p = Number((s as { page: unknown }).page);
    if (Number.isFinite(p) && p >= 1) return Math.floor(p);
  }
  const raw = location.searchStr ?? "";
  const q = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const p = Number(q.get("page"));
  return Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1;
}

function limitFromLocation(location: { search: unknown; searchStr?: string }): number {
  const s = location.search;
  if (typeof s === "object" && s !== null && "limit" in s) {
    return normalizePageLimit((s as { limit: unknown }).limit);
  }
  const raw = location.searchStr ?? "";
  const q = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  return normalizePageLimit(q.get("limit"));
}

export const Route = createFileRoute("/_admin/tenders/")({
  validateSearch: (raw: Record<string, unknown>): TendersSearch => {
    const page = Number(raw.page);
    return {
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      limit: normalizePageLimit(raw.limit),
    };
  },
  ssr: false,
  component: TendersList,
});

function truncate(s: string, max: number) {
  const t = sanitizeApiText(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isGovernmentProcurementQuery(s: string): boolean {
  const q = s.trim().toLowerCase();
  return q.includes("государствен") || q.includes("гос закуп") || q.includes("госзакуп");
}

const statusColorMap: Record<string, string> = {
  green: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  orange: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  gray: "bg-muted/50 text-muted-foreground",
};

const deadlineBadgeClass: Record<string, string> = {
  green: "border-green-200 bg-green-50 text-green-700",
  orange: "border-yellow-200 bg-yellow-50 text-yellow-800",
  red: "border-red-200 bg-red-50 text-red-700",
  gray: "border-border bg-muted/50 text-muted-foreground",
};

function lotStatusLabel(status?: string | null): string {
  const value = sanitizeApiText(status || "");
  if (!value || value.toLowerCase() === "active") return "Активен";
  return value;
}

function lotStatusColor(status?: string | null, fallback: keyof typeof statusColorMap = "gray"): keyof typeof statusColorMap {
  const value = sanitizeApiText(status || "").toLowerCase();
  if (value.includes("отмен") || value.includes("не состоя")) return "red";
  if (value.includes("заверш") || value.includes("итог")) return "gray";
  if (value.includes("опублик") || value.includes("прием") || value.includes("приём") || value === "active") return "green";
  return fallback;
}

function deadlineBadgeLabel(daysLeft: number | null): string {
  if (daysLeft === null) return "—";
  if (daysLeft < 0) return "истёк";
  if (daysLeft === 0) return "сегодня";
  return `${daysLeft} дн.`;
}

function sourceBadgeClass(source?: string | null): string {
  switch ((source || "").toLowerCase()) {
    case "samruk":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "zakup":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "goszakup":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

function renderAiStatusLabel(status?: string | null): string {
  const value = (status || "").trim().toLowerCase();
  switch (value) {
    case "ok":
      return "AI оценка";
    case "cooldown":
      return "AI временно недоступен";
    case "rate_limited":
      return "AI ждёт лимит";
    case "manual_removed":
      return "Убрано вручную";
    case "no_spec_text":
    case "document_download_disabled":
    case "document_text_unavailable":
    case "no_supported_documents":
      return "Требуется ТС";
    case "no_relevant_spec_signals":
      return "Не профиль Tender";
    case "error":
      return "AI ошибка";
    default:
      return value ? "AI проверен" : "AI в очереди";
  }
}

function renderAiStatusClass(status?: string | null, suitable?: boolean | null): string {
  const value = (status || "").trim().toLowerCase();
  if (suitable) return "border-green-200 bg-green-50 text-green-700";
  if (value === "ok") return "border-sky-200 bg-sky-50 text-sky-700";
  if (value === "cooldown" || value === "rate_limited") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "manual_removed") return "border-red-200 bg-red-50 text-red-700";
  if (value === "no_relevant_spec_signals") return "border-slate-200 bg-slate-50 text-slate-600";
  if (value === "no_spec_text" || value === "document_text_unavailable" || value === "no_supported_documents") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-border bg-muted/50 text-muted-foreground";
}

function aiScoreTone(score?: number | null): string {
  if (typeof score !== "number") return "text-muted-foreground";
  if (score > 50) return "text-green-700";
  if (score >= 35) return "text-amber-700";
  return "text-red-700";
}

function aiScoreBarTone(score?: number | null): string {
  if (typeof score !== "number") return "bg-muted-foreground/30";
  if (score > 50) return "bg-green-500";
  if (score >= 35) return "bg-amber-500";
  return "bg-red-500";
}

const obviousNonProfileMarkers = [
  "станок",
  "видеопроектор",
  "dlp-проектор",
  "dlp проектор",
  "проектор",
  "кабель-канал",
  "кабель канал",
  "канцеляр",
  "принтер",
  "сканер",
  "компьютер",
  "ноутбук",
  "планшет",
  "научно-технической обработке документов",
  "научно технической обработке документов",
  "обработке документов",
  "экспертизе образовательных программ",
  "образовательных программ",
];

function isObviousNonProfileTender(tender: TenderItem): boolean {
  const text = sanitizeApiText([
    tender.title,
    tender.description,
    tender.purchaseType,
    tender.matchedKeyword,
  ].filter(Boolean).join(" ")).toLowerCase().replace(/ё/g, "е");
  return obviousNonProfileMarkers.some((marker) => text.includes(marker));
}

type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

function buildPaginationItems(currentPage: number, pageCount: number): PaginationItem[] {
  const total = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, currentPage), total);
  if (total <= 9) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, 2, total - 1, total]);
  for (let p = current - 2; p <= current + 2; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: PaginationItem[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    const previous = typeof last === "number" ? last : null;
    if (previous !== null && p - previous > 1) {
      out.push(previous < current ? "ellipsis-start" : "ellipsis-end");
    }
    out.push(p);
  }
  return out;
}

function TendersList() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageFromLocation(location);
  const limit = limitFromLocation(location);
  const [data, setData] = useState<TendersListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [viewedIds, setViewedIds] = useState<Set<number>>(() => getViewedTenders());
  const [viewInfoMap, setViewInfoMap] = useState<Record<string, TenderViewInfo>>(() => getAllViewInfo());
  const [activeTab, setActiveTab] = useState("Все");
  const [showFilters, setShowFilters] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filterMinAmount, setFilterMinAmount] = useState("");
  const [filterMaxAmount, setFilterMaxAmount] = useState("");
  const [participatingItems, setParticipatingItems] = useState<TenderItem[]>([]);
  const [removingSuitableIds, setRemovingSuitableIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    apiFetch(`${getLocalApiBase()}/api/v1/lots/saved`)
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d)) return;
        // Вкладка "Участвуем" показывает сами сохранённые заявки (включая истёкшие),
        // а не фильтрует ленту активных тендеров — иначе счётчик и список расходятся
        // (истёкший участвующий лот считается в бейдже, но пропадает из активной ленты).
        setParticipatingItems(
          d
            .filter((l: any) => l.status === "participating")
            .map((l: any) => ({
              id: l.id,
              lot: l.external_id || "",
              lot_source_id: l.external_id ?? null,
              source: l.source ?? null,
              sourceLabel: null,
              title: l.title || "",
              description: l.description || "",
              cost: typeof l.amount === "number" ? l.amount : 0,
              partnerLink: l.partner_link || "",
              place: "",
              buy_id: 0,
              endDate: l.end_date || l.deadline || null,
              startDate: l.start_date || null,
              organizer_name: l.organizer_name ?? null,
              status: l.status ?? null,
              purchaseType: l.purchase_type ?? null,
              isSuitable: null,
              matchedKeyword: null,
              aiStatus: null,
            } as TenderItem)),
        );
      })
      .catch(() => {});
  }, []);

  // Refresh viewed set when window regains focus (user navigated back from detail page)
  useEffect(() => {
    const refresh = () => { setViewedIds(getViewedTenders()); setViewInfoMap(getAllViewInfo()); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const keywords = isGovernmentProcurementQuery(searchText) ? "" : searchText;
    fetchTendersList({ page, limit, keywords, suitable: activeTab === "Подходящие" })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, limit, searchText, activeTab]);

  const baseItems = activeTab === "Участвуем" ? participatingItems : (data?.items ?? []);
  const filteredItems = baseItems.filter((t) => {
    if (activeTab !== "Участвуем" && isObviousNonProfileTender(t)) return false;
    const status = getTenderStatus(t.endDate);
    if (activeTab === "Активные" && status.color === "gray") return false;
    if (activeTab === "Истекающие" && status.color !== "red" && status.color !== "orange") return false;
    if (activeTab === "Завершённые" && status.color !== "gray") return false;
    const minA = parseFloat(filterMinAmount);
    const maxA = parseFloat(filterMaxAmount);
    if (!isNaN(minA) && t.cost < minA) return false;
    if (!isNaN(maxA) && t.cost > maxA) return false;
    return true;
  });
  const tenderStats = useMemo(() => {
    const sourceItems = activeTab === "Участвуем" ? participatingItems : (data?.items ?? []);
    const urgent = sourceItems.filter((item) => {
      const status = getTenderStatus(item.endDate);
      return status.color === "red" || status.color === "orange";
    }).length;
    const suitable = sourceItems.filter((item) => item.isSuitable).length;
    const visibleAmount = filteredItems.reduce((sum, item) => sum + (Number.isFinite(item.cost) ? item.cost : 0), 0);
    const total = Math.max(1, sourceItems.length);

    return {
      sourceCount: sourceItems.length,
      suitable,
      urgent,
      visibleAmount,
      suitablePercent: Math.round((suitable / total) * 100),
      urgentPercent: Math.round((urgent / total) * 100),
    };
  }, [activeTab, data?.items, filteredItems, participatingItems]);
  const currentPage = data?.meta.page ?? page;
  const pageCount = Math.max(1, data?.meta.pageCount || 1);

  async function handleRemoveFromSuitable(tender: TenderItem) {
    if (removingSuitableIds.has(tender.id)) return;
    setRemovingSuitableIds((prev) => new Set(prev).add(tender.id));
    setError(null);
    const previous = data;
    setData((current) => current
      ? {
          ...current,
          items: current.items.filter((item) => item.id !== tender.id),
          meta: {
            ...current.meta,
            totalCount: Math.max(0, (current.meta.totalCount || current.items.length) - 1),
          },
        }
      : current);
    try {
      await removeTenderFromSuitable(tender.id);
    } catch (e: unknown) {
      setData(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemovingSuitableIds((prev) => {
        const next = new Set(prev);
        next.delete(tender.id);
        return next;
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Тендеры"
        description="Лента закупок с AI-оценкой, дедлайнами и быстрым переходом в работу"
        actions={
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors ${showFilters ? "bg-accent text-accent-foreground" : "bg-background hover:bg-accent"}`}
          >
            <Filter className="h-4 w-4" /> {showFilters ? "Скрыть фильтры" : "Фильтры"}
          </button>
        }
      />

      <div className="bg-muted/20">
        <div className="mx-auto max-w-[1800px] space-y-5 px-6 py-6 xl:px-8">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric title="В выборке" value={String(filteredItems.length)} hint={`из ${tenderStats.sourceCount} на странице`} icon={FileText} tone="blue" progress={filteredItems.length > 0 ? 100 : 0} />
            <Metric title="Подходящие" value={String(tenderStats.suitable)} hint="AI отметил релевантными" icon={Sparkles} tone="green" progress={tenderStats.suitablePercent} />
            <Metric title="Срочные" value={String(tenderStats.urgent)} hint="дедлайн близко" icon={BriefcaseBusiness} tone="amber" progress={tenderStats.urgentPercent} />
            <Metric title="Сумма" value={`₸ ${formatAmountShort(tenderStats.visibleAmount)}`} hint="по текущей выборке" icon={Banknote} tone="teal" progress={tenderStats.visibleAmount > 0 ? 72 : 0} />
          </div>

          <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SlidersHorizontal className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Фильтр тендеров</p>
                  <p className="text-xs text-muted-foreground">
                    {activeTab}: {filteredItems.length} записей; сумма ₸ {formatAmountShort(tenderStats.visibleAmount)}
                  </p>
                </div>
              </div>

              <div className="grid w-full gap-2 lg:grid-cols-[minmax(280px,1fr)_180px_180px] 2xl:w-[820px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Поиск по названию, заказчику, виду закупки"
                    value={searchText}
                    onChange={(e) => {
                      setSearchText(e.target.value);
                      if (page !== 1) {
                        navigate({ to: "/tenders", search: { page: 1, limit } });
                      }
                    }}
                    className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                <input
                  type="number"
                  placeholder="Мин. сумма ₸"
                  value={filterMinAmount}
                  onChange={(e) => setFilterMinAmount(e.target.value)}
                  className={`${showFilters ? "block" : "hidden lg:block"} h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10`}
                />
                <input
                  type="number"
                  placeholder="Макс. сумма ₸"
                  value={filterMaxAmount}
                  onChange={(e) => setFilterMaxAmount(e.target.value)}
                  className={`${showFilters ? "block" : "hidden lg:block"} h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10`}
                />
              </div>
            </div>

            {showFilters && (
              <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-3">
                <span className="rounded-lg bg-muted/40 px-3 py-2">Вкладка: {activeTab}</span>
                <span className="rounded-lg bg-muted/40 px-3 py-2">От: {filterMinAmount ? `₸ ${formatAmountShort(Number(filterMinAmount))}` : "без минимума"}</span>
                <span className="rounded-lg bg-muted/40 px-3 py-2">До: {filterMaxAmount ? `₸ ${formatAmountShort(Number(filterMaxAmount))}` : "без максимума"}</span>
              </div>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            {[
              { key: "Все", count: data?.items?.length },
              { key: "Подходящие" },
              { key: "Активные" },
              { key: "Истекающие" },
              { key: "Завершённые" },
              { key: "Участвуем", count: participatingItems.length, icon: CheckCircle2 },
            ].map(({ key: tab, count, icon: Icon }) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (page !== 1) {
                    navigate({ to: "/tenders", search: { page: 1, limit } });
                  }
                }}
                className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${
                  activeTab === tab
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:bg-accent"
                }`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {tab}
                {count !== undefined && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${activeTab === tab ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>{count}</span>
                )}
              </button>
            ))}
          </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {loading && !data ? (
            <div className="flex items-center justify-center px-6 py-24 text-sm text-muted-foreground">Загрузка…</div>
          ) : data ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1240px] text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">ID / закупка</th>
                      <th className="px-4 py-3 text-left font-medium">Лот / источник</th>
                      <th className="px-4 py-3 text-left font-medium">Тендер</th>
                      <th className="px-4 py-3 text-left font-medium">Подходит</th>
                      <th className="px-4 py-3 text-right font-medium">Сумма ₸</th>
                      <th className="px-4 py-3 text-left font-medium">Дедлайн</th>
                      <th className="px-4 py-3 text-left font-medium">Статус</th>
                      <th className="px-4 py-3 text-center font-medium">Ссылка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((t) => {
                      const statusInfo = getTenderStatus(t.endDate);
                      const lotStatusColorKey = lotStatusColor(t.status, statusInfo.color);
                      const companyName = tenderCompanyName(t);
                      const sourceLabel = tenderSourceLabel(t);

                      return (
                        <tr
                          key={t.id}
                          role="link"
                          tabIndex={0}
                          className="group cursor-pointer bg-card transition hover:bg-muted/30"
                          onClick={() =>
                            navigate({
                              to: "/tenders/$tenderId",
                              params: { tenderId: String(t.id) },
                              state: (prev) => ({ ...prev, tendersPage: page }),
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              navigate({
                                to: "/tenders/$tenderId",
                                params: { tenderId: String(t.id) },
                                state: (prev) => ({ ...prev, tendersPage: page }),
                              });
                            }
                          }}
                        >
                          <td className="px-4 py-4 align-top font-mono text-xs text-muted-foreground">
                            <div className="flex items-start gap-2">
                              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                lotStatusColorKey === "green" ? "bg-green-500" :
                                lotStatusColorKey === "orange" ? "bg-yellow-500" :
                                lotStatusColorKey === "red" ? "bg-red-500" : "bg-muted-foreground"
                              }`} />
                              <div>
                                <div>{t.id}</div>
                                <div className="mt-0.5 text-[10px] text-muted-foreground/80">buy_id {t.buy_id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top font-mono text-xs text-foreground">
                            <div>{t.lot}</div>
                            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceBadgeClass(t.source)}`}>
                              {sourceLabel}
                            </span>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">{t.lot_source_id || "—"}</div>
                          </td>
                          <td className="max-w-[430px] px-4 py-4 align-top">
                            <div className="flex items-start gap-2">
                              <p className="line-clamp-2 max-w-sm font-semibold leading-5 text-foreground group-hover:text-primary">{truncate(t.title, 120)}</p>
                              {viewedIds.has(t.id) && (() => {
                                const vi = viewInfoMap[String(t.id)];
                                return (
                                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    Просмотрено{vi?.viewer ? ` (${vi.viewer})` : ""}
                                    {vi?.decision === "participating" && (
                                      <span className="rounded-full bg-green-100 px-1.5 py-px text-[9px] font-semibold text-green-700">Участвуем</span>
                                    )}
                                    {vi?.decision === "rejected" && (
                                      <span className="rounded-full bg-red-100 px-1.5 py-px text-[9px] font-semibold text-red-600">Отклонён</span>
                                    )}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-2 line-clamp-2 max-w-sm text-xs font-medium leading-4 text-foreground/80">
                              {companyName || "Компания не указана"}
                            </div>
                            {t.isSuitable && t.matchedKeyword && (
                              <div className="mt-1 inline-flex rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                Подходит: {t.matchedKeyword}
                              </div>
                            )}
                            <div className="mt-1 line-clamp-1 max-w-sm text-xs text-muted-foreground">{truncate(t.description, 130)}</div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            {typeof t.aiScore === "number" ? (
                              <div className="min-w-28">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <span className={`text-sm font-bold tabular-nums ${aiScoreTone(t.aiScore)}`}>{t.aiScore}%</span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${renderAiStatusClass(t.aiStatus, t.isSuitable)}`}>
                                    {renderAiStatusLabel(t.aiStatus)}
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={`h-full rounded-full ${aiScoreBarTone(t.aiScore)}`}
                                    style={{ width: `${Math.max(0, Math.min(100, t.aiScore))}%` }}
                                  />
                                </div>
                                {t.aiProvider && <div className="mt-1 text-[10px] text-muted-foreground">{t.aiProvider}</div>}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">ожидает AI</span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right align-top font-semibold tabular-nums">{formatTenderAmount(t.cost)}</td>
                          <td className="px-4 py-4 align-top text-xs text-muted-foreground">
                            {t.endDate ? (
                              <div className="flex min-w-[128px] flex-col gap-1">
                                <span className="font-medium text-foreground">{formatDate(t.endDate)}</span>
                                <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${deadlineBadgeClass[statusInfo.color]}`}>
                                  {deadlineBadgeLabel(statusInfo.daysLeft)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${statusColorMap[lotStatusColorKey]}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${
                                lotStatusColorKey === "green" ? "bg-green-500" :
                                lotStatusColorKey === "orange" ? "bg-yellow-500" :
                                lotStatusColorKey === "red" ? "bg-red-500" : "bg-muted-foreground"
                              }`} />
                              {lotStatusLabel(t.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center align-top">
                            <div className="flex items-center justify-center gap-1">
                            {activeTab === "Подходящие" && (
                              <button
                                type="button"
                                disabled={removingSuitableIds.has(t.id)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                                title="Удалить из Подходящих"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleRemoveFromSuitable(t);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                            <a
                              href={t.partnerLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-primary transition hover:bg-accent"
                              title="Открыть на площадке"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredItems.length === 0 && !loading && (
                      <tr>
                        <td colSpan={8} className="px-6 py-16 text-center text-sm text-muted-foreground">
                          {searchText.trim()
                            ? "По названию, заказчику или виду закупки тендеры не найдены. Попробуйте другое слово или сбросьте фильтр."
                            : "Тендеры не найдены"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-6 py-3 text-sm text-muted-foreground">
                <span>
                  Стр. {currentPage} из {pageCount} · записей: {filteredItems.length} · всего: {data.meta.totalCount}
                  {loading ? " · обновление…" : ""}
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="tenders-page-limit" className="flex items-center gap-2">
                    <span>На странице</span>
                    <select
                      id="tenders-page-limit"
                      value={limit}
                      onChange={(e) =>
                        navigate({
                          to: "/tenders",
                          search: { page: 1, limit: normalizePageLimit(e.target.value) },
                        })
                      }
                      className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                    >
                      {PAGE_LIMIT_OPTIONS.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-1">
                  <Link
                    to="/tenders"
                    search={{ page: Math.max(1, currentPage - 1), limit }}
                    className={`rounded-lg border border-border bg-background px-3 py-1 hover:bg-accent ${currentPage <= 1 ? "pointer-events-none opacity-40" : ""}`}
                  >
                    ←
                  </Link>
                  {buildPaginationItems(currentPage, pageCount).map((entry) => (
                    typeof entry === "number" ? (
                      <Link
                        key={entry}
                        to="/tenders"
                        search={{ page: entry, limit }}
                        className={`rounded-lg px-3 py-1 ${entry === currentPage ? "bg-primary text-primary-foreground" : "border border-border bg-background hover:bg-accent"}`}
                      >
                        {entry}
                      </Link>
                    ) : (
                      <span key={entry} className="rounded-lg px-2 py-1 text-muted-foreground">...</span>
                    )
                  ))}
                  <Link
                    to="/tenders"
                    search={{ page: Math.min(pageCount, currentPage + 1), limit }}
                    className={`rounded-lg border border-border bg-background px-3 py-1 hover:bg-accent ${currentPage >= pageCount ? "pointer-events-none opacity-40" : ""}`}
                  >
                    →
                  </Link>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
      </div>
    </>
  );
}

type MetricTone = "blue" | "green" | "amber" | "teal";

const metricTone: Record<MetricTone, { shell: string; icon: string; bar: string }> = {
  blue: { shell: "border-blue-100 bg-blue-50/70", icon: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
  green: { shell: "border-emerald-100 bg-emerald-50/80", icon: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  amber: { shell: "border-amber-100 bg-amber-50/80", icon: "bg-amber-100 text-amber-800", bar: "bg-amber-500" },
  teal: { shell: "border-teal-100 bg-teal-50/80", icon: "bg-teal-100 text-teal-700", bar: "bg-teal-500" },
};

function Metric({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  progress,
}: {
  title: string;
  value: string;
  hint: string;
  icon: ElementType;
  tone: MetricTone;
  progress: number;
}) {
  const cls = metricTone[tone];
  return (
    <div className={`overflow-hidden rounded-lg border p-4 shadow-sm ${cls.shell}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 truncate text-2xl font-bold text-foreground">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${cls.icon}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background/80">
        <div className={`h-full rounded-full ${cls.bar}`} style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
      </div>
    </div>
  );
}

function formatAmountShort(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} млрд`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} тыс`;
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}
