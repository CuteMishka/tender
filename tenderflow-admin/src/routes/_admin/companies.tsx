import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Building2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Gavel,
  Loader2,
  PlusCircle,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import {
  analyticsApi,
  fmtDate,
  fmtLotNumber,
  fmtM,
  fmtN,
  type CompanyContract,
  type CompanyInsight,
  type CompanyOffer,
  type CompanyRecentEvent,
  type CompanyTender,
  type CompanyTenderIntelligence,
} from "@/lib/analytics-api";
import { getLocalApiBase } from "@/lib/tenders-api";
import { exportStyledXlsx } from "@/lib/xlsx-export";

export const Route = createFileRoute("/_admin/companies")({
  component: Companies,
});

const quickQueries = ["201040033189", "Tender Mobile", "Витанова", "Tender"];
const monitoredCompaniesKey = "tender_monitored_companies_v1";
const dictionaryStorageKey = "parser_dictionaries_v1";

type DictItem = {
  kind?: string;
  value?: string;
  active?: boolean;
};

const severityClass: Record<string, string> = {
  success: "border-green-200 bg-green-50 text-green-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
};

const confidenceLabel: Record<string, string> = {
  high: "точное совпадение",
  medium: "средняя точность",
  low: "мало данных",
};

function Companies() {
  const [searchText, setSearchText] = useState("");
  const [result, setResult] = useState<CompanyTenderIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profileKeywords, setProfileKeywords] = useState<string[]>([]);
  const [monitoredCompanies, setMonitoredCompanies] = useState<string[]>(() => loadMonitoredCompanies());

  useEffect(() => {
    let active = true;
    fetchProfileKeywords()
      .then((keywords) => {
        if (active) setProfileKeywords(keywords);
      })
      .catch(() => {
        if (active) setProfileKeywords(loadLocalProfileKeywords());
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const q = searchText.trim();
    if (q.length < 2) {
      setResult(null);
      setError("");
      setLoading(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      analyticsApi.getCompanyTenders(q, 10000)
        .then((data) => {
          if (active) setResult(data);
        })
        .catch((err: Error) => {
          if (active) {
            setResult(null);
            setError(readableError(err.message));
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 450);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchText]);

  const summary = result?.summary;
  const mainMatch = result?.matches[0];
  const profilePublished = useMemo(
    () => filterCompanyTendersByKeywords(result?.published ?? [], profileKeywords),
    [result?.published, profileKeywords],
  );
  const buyingCount = summary ? (summary.customer_contracts_count || summary.published_count) : 0;
  const buyingAmount = summary ? (summary.customer_contracts_amount || summary.published_budget) : 0;
  const stats = useMemo(() => {
    if (!summary) return [];
    return [
      {
        label: "Публикует",
        value: fmtN(summary.published_count),
        detail: `${fmtN(summary.active_published_count)} активных`,
        icon: Gavel,
      },
      {
        label: "Бюджет публикаций",
        value: `₸ ${fmtM(summary.published_budget)}`,
        detail: "по найденным лотам",
        icon: Banknote,
      },
      {
        label: "Выигрывает",
        value: fmtN(summary.won_contracts_count),
        detail: `₸ ${fmtM(summary.won_contracts_amount)}`,
        icon: Trophy,
      },
      {
        label: "Покупает",
        value: fmtN(buyingCount),
        detail: `₸ ${fmtM(buyingAmount)}`,
        icon: Building2,
      },
      {
        label: "Участвует",
        value: fmtN(summary.participated_count),
        detail: "заявки TenderPlus",
        icon: Users,
      },
    ];
  }, [summary, buyingCount, buyingAmount]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchText((value) => value.trim());
  };

  const addCurrentToMonitoring = () => {
    const candidate = (mainMatch?.bin || mainMatch?.name || result?.query || searchText).trim();
    if (!candidate) return;
    setMonitoredCompanies((current) => {
      const next = Array.from(new Set([candidate, ...current])).slice(0, 20);
      saveMonitoredCompanies(next);
      return next;
    });
  };

  const removeMonitoredCompany = (company: string) => {
    setMonitoredCompanies((current) => {
      const next = current.filter((item) => item !== company);
      saveMonitoredCompanies(next);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title="Компании"
        description="TenderPlus intelligence по заказчикам, поставщикам и участникам"
        actions={
          result ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              <Activity className="h-4 w-4 text-primary" />
              {result.source}
            </div>
          ) : null
        }
      />

      <div className="min-w-0 space-y-5 overflow-x-hidden p-8">
        <section className="min-w-0 rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Название или БИН компании"
                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              disabled={searchText.trim().length < 2 || loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Найти
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            {quickQueries.map((item) => (
              <button
                key={item}
                onClick={() => setSearchText(item)}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                {item}
              </button>
            ))}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase text-muted-foreground">Мониторинг компаний</p>
              {result && (
                <button
                  type="button"
                  onClick={addCurrentToMonitoring}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Добавить
                </button>
              )}
            </div>
            {monitoredCompanies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Добавьте компанию после поиска, чтобы быстро возвращаться к ее профильным тендерам.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {monitoredCompanies.map((company) => (
                  <span key={company} className="inline-flex items-center overflow-hidden rounded-full border border-border bg-background text-xs">
                    <button
                      type="button"
                      onClick={() => setSearchText(company)}
                      className="px-3 py-1.5 text-muted-foreground transition hover:text-foreground"
                      title="Открыть мониторинг компании"
                    >
                      {company}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMonitoredCompany(company)}
                      className="border-l border-border px-2 py-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      title="Убрать из мониторинга"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && !result && <LoadingState />}

        {!loading && !result && !error && <EmptyState />}

        {result && summary && (
          <>
            <section className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)]">
              <div className="min-w-0 rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="min-w-0 max-w-full truncate text-lg font-semibold text-foreground">
                        {mainMatch?.name || result.query}
                      </h2>
                      {mainMatch?.bin && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                          {mainMatch.bin}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {confidenceLabel[summary.confidence] || summary.confidence}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {mainMatch?.roles.map((role) => (
                        <span key={role} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          <BadgeCheck className="h-3 w-3" />
                          {role}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 border-t border-border pt-4">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Совпадения</p>
                  <div className="mt-3 space-y-2">
                    {result.matches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Нет точных совпадений по юрлицам</p>
                    ) : result.matches.map((match) => (
                      <div key={`${match.bin}-${match.name}`} className="rounded-lg border border-border bg-background p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="min-w-0 truncate text-sm font-medium">{match.name || "Компания без названия"}</p>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">{match.bin || "БИН не найден"}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {match.score}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(160px,1fr))] content-start items-start gap-3">
                {stats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className="min-w-0 self-start rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>
                      <p className="mt-4 truncate text-xs text-muted-foreground">{stat.label}</p>
                      <p className="mt-1 truncate text-xl font-semibold text-foreground">{stat.value}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{stat.detail}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="min-w-0 rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                <div className="mb-4 flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Выводы</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {result.insights.map((insight) => (
                    <InsightCard key={`${insight.kind}-${insight.title}`} insight={insight} />
                  ))}
                </div>
              </div>

              <div className="min-w-0 rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                <div className="mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Срез</h3>
                </div>
                <dl className="space-y-3 text-sm">
                  <Row label="Последняя активность" value={fmtDate(summary.last_activity_at)} />
                  <Row label="Активные публикации" value={fmtN(summary.active_published_count)} />
                  <Row label="Победы поставщика" value={fmtN(summary.won_contracts_count)} />
                  <Row label="Покупки / публикации" value={fmtN(buyingCount)} />
                </dl>
              </div>
            </section>

            {result.warnings && result.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {result.warnings.slice(0, 2).join(" ")}
              </div>
            )}

            <RecentActivityPanel items={result.aggregates?.recent ?? []} />
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-primary">
              В публикациях показаны только лоты, которые совпали с активными ключевыми словами справочника.
              {profileKeywords.length > 0 ? ` Найдено профильных: ${profilePublished.length}.` : " В справочнике пока нет активных ключевых слов."}
            </div>
            <TenderTable title="Публиковали" icon={Gavel} items={profilePublished} total={profilePublished.length} />
            <ContractTable title="Выигрывали" icon={Trophy} items={result.won_contracts} role="supplier" total={summary.won_contracts_count} />
            <ContractTable title="Покупали по договорам" icon={FileText} items={result.customer_contracts} role="customer" total={summary.customer_contracts_count} />
            <OfferTable items={result.participated} total={summary.participated_count} />
          </>
        )}
      </div>
    </>
  );
}

function InsightCard({ insight }: { insight: CompanyInsight }) {
  return (
    <div className={`rounded-lg border p-4 ${severityClass[insight.severity] || severityClass.info}`}>
      <p className="text-sm font-semibold">{insight.title}</p>
      <p className="mt-1 text-xs leading-5 opacity-85">{insight.message}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function RecentActivityPanel({ items }: { items: CompanyRecentEvent[] }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <SectionTitle title="Недавние" count={items.length} visible={items.length} icon={Clock} />
      {items.length === 0 ? <TableEmpty text="Нет недавних событий" /> : (
        <div className="divide-y divide-border">
          {items.slice(0, 8).map((item, index) => (
            <div key={`${item.kind}-${item.date}-${index}`} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {recentKindLabel(item.kind)}
                  </span>
                  {item.status && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{item.status}</span>}
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{item.title || "Без названия"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.subtitle || "—"}</p>
              </div>
              <div className="text-sm font-semibold">₸ {fmtM(item.amount)}</div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{fmtDate(item.date)}</span>
                {item.link && (
                  <a href={item.link} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent" title="Открыть">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function recentKindLabel(kind: string): string {
  if (kind === "won") return "Победа";
  if (kind === "customer_contract") return "Договор";
  if (kind === "participated") return "Заявка";
  return "Публикация";
}

function TenderTable({ title, icon: Icon, items, total }: { title: string; icon: LucideIcon; items: CompanyTender[]; total?: number }) {
  const defaults = useMemo(() => defaultFilterDates(), []);
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [platform, setPlatform] = useState("all");
  const [company, setCompany] = useState("");
  const [search, setSearch] = useState("");
  const platforms = useMemo(() => uniquePlatforms(items), [items]);
  const filteredItems = useMemo(() => {
    const needle = normalizeSearch(search);
    const companyNeedle = normalizeSearch(company);
    const from = dateBoundary(fromDate, false);
    const to = dateBoundary(toDate, true);
    return items.filter((item) => {
      const itemDate = companyTenderDateValue(item);
      if (from != null && (itemDate == null || itemDate < from)) return false;
      if (to != null && (itemDate == null || itemDate > to)) return false;
      if (platform !== "all" && (item.platform || "") !== platform) return false;
      if (companyNeedle && !normalizeSearch([
        item.customer_name,
        item.customer_bin,
        item.organizer,
      ].join(" ")).includes(companyNeedle)) return false;
      if (needle && !normalizeSearch([
        item.title,
        item.lot_number,
        item.status,
        item.platform,
        item.purchase_type,
      ].join(" ")).includes(needle)) return false;
      return true;
    });
  }, [items, search, company, fromDate, toDate, platform]);

  const resetFilters = () => {
    const next = defaultFilterDates();
    setFromDate(next.from);
    setToDate(next.to);
    setPlatform("all");
    setCompany("");
    setSearch("");
  };

  const exportExcel = async () => {
    const companyName = items.find((item) => item.customer_name || item.organizer)?.customer_name
      || items.find((item) => item.organizer)?.organizer
      || "Компания";
    await exportStyledXlsx({
      fileName: `publikacii_${dateStamp()}.xlsx`,
      sheetName: "Публикации",
      title: `${title}: ${companyName}`,
      subtitle: `Сформировано ${new Date().toLocaleString("ru-RU")} · записей: ${filteredItems.length}`,
      filters: [
        { label: "Период публикации", value: `${fromDate || "без начала"} - ${toDate || "без окончания"}` },
        { label: "Площадка", value: platform === "all" ? "Все площадки" : platform },
        { label: "Компания", value: company.trim() || "Все компании" },
        { label: "Ключевое слово", value: search.trim() || "Все лоты" },
      ],
      columns: [
        { key: "lot", header: "Лот", width: 14 },
        { key: "title", header: "Название лота", width: 52 },
        { key: "company", header: "Компания", width: 44 },
        { key: "bin", header: "БИН", width: 16 },
        { key: "status", header: "Статус", width: 16 },
        { key: "amount", header: "Сумма", width: 16, type: "money" },
        { key: "deadline", header: "Срок", width: 16 },
        { key: "published", header: "Публикация", width: 16 },
        { key: "platform", header: "Площадка", width: 20 },
        { key: "purchaseType", header: "Тип закупки", width: 24 },
        { key: "link", header: "Ссылка", width: 46 },
      ],
      rows: filteredItems.map((item) => ({
        lot: fmtLotNumber(item.lot_number, item.id),
        title: item.title || "Без названия",
        company: item.customer_name || item.organizer || "",
        bin: item.customer_bin || "",
        status: item.status || "",
        amount: item.amount || 0,
        deadline: fmtDate(item.end_date),
        published: fmtDate(item.publish_date),
        platform: item.platform || "",
        purchaseType: item.purchase_type || "",
        link: item.link || "",
      })),
    });
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <SectionTitle title={title} count={total ?? items.length} visible={filteredItems.length} icon={Icon} />
      {items.length > 0 && (
        <div className="border-b border-border px-5 py-3">
          <div className="grid gap-2 xl:grid-cols-[minmax(230px,0.9fr)_minmax(170px,0.65fr)_minmax(210px,0.8fr)_minmax(230px,1fr)_auto_auto]">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                title="Дата с"
              />
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                title="Дата по"
              />
            </div>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              title="Площадка"
            >
              <option value="all">Все площадки</option>
              {platforms.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <div className="relative min-w-0">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Часть названия компании"
                className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ключевое слово в лоте"
                className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-accent"
              title="Сбросить фильтры"
            >
              <RotateCcw className="h-4 w-4" />
              Сбросить
            </button>
            <button
              type="button"
              onClick={exportExcel}
              disabled={filteredItems.length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm font-medium text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
              title="Экспорт в Excel"
            >
              <Download className="h-4 w-4" />
              Экспорт
            </button>
          </div>
        </div>
      )}
      {items.length === 0 ? <TableEmpty /> : filteredItems.length === 0 ? <TableEmpty text="Ничего не найдено" /> : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Лот</th>
                <th className="px-5 py-3 text-left font-medium">Компания</th>
                <th className="px-5 py-3 text-left font-medium">Статус</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-5 py-3 text-left font-medium">Срок</th>
                <th className="px-5 py-3 text-left font-medium">Площадка</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-t border-border hover:bg-muted/30">
                  <td className="max-w-[320px] px-5 py-4">
                    <p className="line-clamp-2 font-medium text-foreground">{item.title || "Без названия"}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      Лот № {fmtLotNumber(item.lot_number, item.id)}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="line-clamp-2">{item.customer_name || item.organizer || "—"}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{item.customer_bin || "—"}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{item.status || "—"}</span>
                  </td>
                  <td className="px-5 py-4 text-right font-medium">₸ {fmtM(item.amount)}</td>
                  <td className="px-5 py-4 text-muted-foreground">{fmtDate(item.end_date)}</td>
                  <td className="px-5 py-4 text-muted-foreground">{item.platform || "—"}</td>
                  <td className="px-5 py-4 text-right">
                    {item.link && (
                      <a href={item.link} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent" title="Открыть">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function loadMonitoredCompanies(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(monitoredCompaniesKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function saveMonitoredCompanies(items: string[]): void {
  try {
    localStorage.setItem(monitoredCompaniesKey, JSON.stringify(items));
  } catch {
    // ignore localStorage errors
  }
}

async function fetchProfileKeywords(): Promise<string[]> {
  const res = await fetch(`${getLocalApiBase()}/api/v1/dictionaries`);
  if (!res.ok) throw new Error(`Dictionaries API ${res.status}`);
  const payload = await res.json() as { items?: DictItem[]; data?: DictItem[] };
  const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data) ? payload.data : [];
  return dictionaryItemsToKeywords(items);
}

function loadLocalProfileKeywords(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(dictionaryStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { keywords?: DictItem[] };
    return dictionaryItemsToKeywords(Array.isArray(parsed.keywords) ? parsed.keywords : []);
  } catch {
    return [];
  }
}

function dictionaryItemsToKeywords(items: DictItem[]): string[] {
  const keywords = items
    .filter((item) => (item.kind || "keywords") === "keywords" && item.active !== false)
    .map((item) => normalizeSearch(item.value || ""))
    .filter(Boolean);
  return Array.from(new Set(keywords));
}

function filterCompanyTendersByKeywords(items: CompanyTender[], keywords: string[]): CompanyTender[] {
  const activeKeywords = keywords.map(normalizeSearch).filter(Boolean);
  if (activeKeywords.length === 0) return items;
  return items.filter((item) => {
    const text = normalizeSearch([
      item.title,
      item.purchase_type,
      item.status,
      item.platform,
      item.region,
    ].join(" "));
    return activeKeywords.some((keyword) => text.includes(keyword));
  });
}

function defaultFilterDates(): { from: string; to: string } {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-01-01`,
    to: dateInputValue(now),
  };
}

function dateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function dateBoundary(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  const time = new Date(`${value}${suffix}`).getTime();
  return Number.isFinite(time) ? time : null;
}

function companyTenderDateValue(item: CompanyTender): number | null {
  const raw = item.publish_date || item.end_date || item.begin_date;
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : null;
}

function uniquePlatforms(items: CompanyTender[]): string[] {
  return [...new Set(items.map((item) => item.platform.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ru"));
}

function dateStamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function ContractTable({ title, icon: Icon, items, role, total }: { title: string; icon: LucideIcon; items: CompanyContract[]; role: "supplier" | "customer"; total?: number }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <SectionTitle title={title} count={total ?? items.length} visible={items.length} icon={Icon} />
      {items.length === 0 ? <TableEmpty /> : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Договор</th>
                <th className="px-5 py-3 text-left font-medium">{role === "supplier" ? "Заказчик" : "Поставщик"}</th>
                <th className="px-5 py-3 text-left font-medium">Статус</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-5 py-3 text-left font-medium">Дата</th>
                <th className="px-5 py-3 text-left font-medium">Тендер</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-5 py-4">
                    <p className="font-medium">{item.contract_number || item.id}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">ID {item.id}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="line-clamp-2">{role === "supplier" ? item.customer_name : item.supplier_name}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{role === "supplier" ? item.customer_bin : item.supplier_bin}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{item.status || "—"}</span>
                  </td>
                  <td className="px-5 py-4 text-right font-medium">₸ {fmtM(item.amount)}</td>
                  <td className="px-5 py-4 text-muted-foreground">{fmtDate(item.sign_date)}</td>
                  <td className="max-w-[260px] px-5 py-4">
                    <p className="line-clamp-2">{item.tender_title || "—"}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{item.tender_number || ""}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OfferTable({ items, total }: { items: CompanyOffer[]; total?: number }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <SectionTitle title="Участвовали заявками" count={total ?? items.length} visible={items.length} icon={Users} />
      {items.length === 0 ? <TableEmpty /> : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Лот</th>
                <th className="px-5 py-3 text-left font-medium">Участник</th>
                <th className="px-5 py-3 text-left font-medium">Статус</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-5 py-3 text-left font-medium">Дата</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border hover:bg-muted/30">
                  <td className="max-w-[360px] px-5 py-4">
                    <p className="line-clamp-2 font-medium">{item.lot?.title || `Лот ${item.lot_id}`}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      Лот № {fmtLotNumber(item.lot?.lot_number, item.lot_id)}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="line-clamp-2">{item.organization || "—"}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{item.organization_bin || "—"}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{item.status || "—"}</span>
                  </td>
                  <td className="px-5 py-4 text-right font-medium">₸ {fmtM(item.discount_price || item.amount)}</td>
                  <td className="px-5 py-4 text-muted-foreground">{fmtDate(item.request_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SectionTitle({ title, count, visible, icon: Icon }: { title: string; count: number; visible: number; icon: LucideIcon }) {
  const label = count > visible ? `${fmtN(visible)} из ${fmtN(count)}` : fmtN(count);
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-4">
      <div className="min-w-0 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <h3 className="truncate font-semibold">{title}</h3>
      </div>
      <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function TableEmpty({ text = "Нет данных" }: { text?: string }) {
  return <div className="px-5 py-10 text-center text-sm text-muted-foreground">{text}</div>;
}

function LoadingState() {
  return (
    <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
      <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
      Идёт поиск в TenderPlus
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
      <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm font-medium text-foreground">Поиск компании</p>
      <p className="mt-1 text-sm text-muted-foreground">Результаты появятся после ввода названия или БИН.</p>
    </div>
  );
}

function readableError(message: string): string {
  try {
    const parsed = JSON.parse(message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // keep original message
  }
  return message.replace(/^"|"$/g, "") || "TenderPlus временно недоступен";
}
