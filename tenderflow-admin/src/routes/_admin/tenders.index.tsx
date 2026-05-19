import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { ExternalLink, Filter, CheckCircle2, Trash2 } from "lucide-react";
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

type TendersSearch = { page: number };

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

export const Route = createFileRoute("/_admin/tenders/")({
  validateSearch: (raw: Record<string, unknown>): TendersSearch => {
    const page = Number(raw.page);
    return { page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1 };
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
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  gray: "bg-muted/50 text-muted-foreground",
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

function TendersList() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageFromLocation(location);
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
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [removingSuitableIds, setRemovingSuitableIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch(`${getLocalApiBase()}/api/v1/lots/saved`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setSavedIds(new Set(d.filter((l: any) => l.status === "participating").map((l: any) => l.id))); })
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
    fetchTendersList({ page, limit: 10, keywords, suitable: activeTab === "Подходящие" })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, searchText, activeTab]);

  const filteredItems = (data?.items ?? []).filter((t) => {
    const status = getTenderStatus(t.endDate);
    if (activeTab === "Активные" && status.color === "gray") return false;
    if (activeTab === "Истекающие" && status.color !== "red" && status.color !== "orange") return false;
    if (activeTab === "Завершённые" && status.color !== "gray") return false;
    if (activeTab === "Участвуем" && !savedIds.has(t.id)) return false;
    const minA = parseFloat(filterMinAmount);
    const maxA = parseFloat(filterMaxAmount);
    if (!isNaN(minA) && t.cost < minA) return false;
    if (!isNaN(maxA) && t.cost > maxA) return false;
    return true;
  });

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
        actions={
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors ${showFilters ? "bg-accent text-accent-foreground" : "bg-background hover:bg-accent"}`}
          >
            <Filter className="h-4 w-4" /> Фильтры
          </button>
        }
      />

      <div className="p-8">
        {showFilters && (
          <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm animate-in slide-in-from-top-2">
            <h4 className="mb-4 text-sm font-medium">Параметры фильтрации</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <input
                type="text"
                placeholder="Поиск по названию, заказчику, виду закупки..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  if (page !== 1) {
                    navigate({ to: "/tenders", search: { page: 1 } });
                  }
                }}
                className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm"
              />
              <input
                type="number"
                placeholder="Мин. сумма ₸"
                value={filterMinAmount}
                onChange={(e) => setFilterMinAmount(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm"
              />
              <input
                type="number"
                placeholder="Макс. сумма ₸"
                value={filterMaxAmount}
                onChange={(e) => setFilterMaxAmount(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm"
              />
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: "Все", count: data?.items?.length },
            { key: "Подходящие" },
            { key: "Активные" },
            { key: "Истекающие" },
            { key: "Завершённые" },
            { key: "Участвуем", count: savedIds.size, icon: CheckCircle2 },
          ].map(({ key: tab, count, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (page !== 1) {
                  navigate({ to: "/tenders", search: { page: 1 } });
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === tab ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground hover:bg-accent"}`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {tab}
              {count !== undefined && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${activeTab === tab ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>{count}</span>
              )}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
          {loading && !data ? (
            <div className="flex items-center justify-center px-6 py-24 text-sm text-muted-foreground">Загрузка…</div>
          ) : data ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">ID / закупка</th>
                      <th className="px-4 py-3 text-left font-medium">Лот / источник</th>
                      <th className="px-4 py-3 text-left font-medium">Тендер</th>
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
                          className="cursor-pointer border-t border-border transition hover:bg-muted/40"
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
                          <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                            <div>{t.id}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground/80">buy_id {t.buy_id}</div>
                          </td>
                          <td className="px-4 py-4 font-mono text-xs text-foreground">
                            <div>{t.lot}</div>
                            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceBadgeClass(t.source)}`}>
                              {sourceLabel}
                            </span>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">{t.lot_source_id || "—"}</div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <span className="max-w-sm font-medium text-foreground">{truncate(t.title, 100)}</span>
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
                            <div className="mt-1 max-w-sm text-xs font-medium text-foreground/80">
                              {companyName || "Компания не указана"}
                            </div>
                            {t.isSuitable && t.matchedKeyword && (
                              <div className="mt-1 inline-flex rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                Подходит: {t.matchedKeyword}
                              </div>
                            )}
                            <div className="mt-1 max-w-sm text-xs text-muted-foreground">{truncate(t.description, 120)}</div>
                          </td>
                          <td className="px-4 py-4 text-right font-semibold tabular-nums">{formatTenderAmount(t.cost)}</td>
                          <td className="px-4 py-4 text-xs text-muted-foreground">
                            {t.endDate ? (
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  statusInfo.daysLeft !== null && statusInfo.daysLeft < 0
                                    ? "bg-muted text-muted-foreground"
                                    : "bg-muted/70 text-foreground dark:bg-muted/60 dark:text-foreground"
                                }`}
                                title={formatDate(t.endDate)}
                              >
                                {deadlineBadgeLabel(statusInfo.daysLeft)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${statusColorMap[lotStatusColorKey]}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${
                                lotStatusColorKey === "green" ? "bg-green-500" :
                                lotStatusColorKey === "orange" ? "bg-orange-500" :
                                lotStatusColorKey === "red" ? "bg-red-500" : "bg-muted-foreground"
                              }`} />
                              {lotStatusLabel(t.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                            {activeTab === "Подходящие" && (
                              <button
                                type="button"
                                disabled={removingSuitableIds.has(t.id)}
                                className="inline-flex rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
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
                              className="inline-flex rounded-md p-2 text-primary hover:bg-accent"
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
                        <td colSpan={7} className="px-6 py-16 text-center text-sm text-muted-foreground">
                          {searchText.trim()
                            ? "По названию, заказчику или виду закупки тендеры не найдены. Попробуйте другое слово или сбросьте фильтр."
                            : "Тендеры не найдены"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3 text-sm text-muted-foreground">
                <span>
                  Стр. {page} из {Math.max(1, data.meta.pageCount || 1)} · записей: {filteredItems.length} · всего: {data.meta.totalCount}
                  {loading ? " · обновление…" : ""}
                </span>
                <div className="flex flex-wrap gap-1">
                  <Link
                    to="/tenders"
                    search={{ page: Math.max(1, page - 1) }}
                    className={`rounded-md border border-border px-3 py-1 hover:bg-accent ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
                  >
                    ←
                  </Link>
                  {Array.from({ length: Math.max(1, data.meta.pageCount || 1) }, (_, i) => i + 1).map((p) => (
                    <Link
                      key={p}
                      to="/tenders"
                      search={{ page: p }}
                      className={`rounded-md px-3 py-1 ${p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}
                    >
                      {p}
                    </Link>
                  ))}
                  <Link
                    to="/tenders"
                    search={{ page: Math.min(Math.max(1, data.meta.pageCount || 1), page + 1) }}
                    className={`rounded-md border border-border px-3 py-1 hover:bg-accent ${page >= (data.meta.pageCount || 1) ? "pointer-events-none opacity-40" : ""}`}
                  >
                    →
                  </Link>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
