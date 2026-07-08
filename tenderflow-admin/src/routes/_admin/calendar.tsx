import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Search,
  ShieldCheck,
  TableProperties,
} from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { tenderCalendarData } from "@/data/tender-calendar";

export const Route = createFileRoute("/_admin/calendar")({
  component: TenderCalendar,
});

type CalendarTab = "registry" | "contracts" | "top20" | "control";
type DateFilter = "all" | "h2" | "renewals" | "top20";
type CalendarRow = (typeof tenderCalendarData.calendar)[number];
type SamrukContract = (typeof tenderCalendarData.samrukContracts)[number];
type Top20Row = (typeof tenderCalendarData.top20Audit)[number];

const pageSizeOptions = [10, 25, 50, 100];

const tabLabels: Record<CalendarTab, string> = {
  registry: "Общий календарь",
  contracts: "Договора Самрук-Казына",
  top20: "Топ 20",
  control: "Контроль",
};

const dateFilters: { value: DateFilter; label: string }[] = [
  { value: "all", label: "Все даты" },
  { value: "h2", label: "Июль-декабрь 2026" },
  { value: "renewals", label: "Окончание договора 2026" },
  { value: "top20", label: "Только Топ-20" },
];

function TenderCalendar() {
  const [activeTab, setActiveTab] = useState<CalendarTab>("registry");
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const statuses = useMemo(() => {
    const values = new Set<string>();
    tenderCalendarData.calendar.forEach((row) => {
      if (row.status) values.add(row.status);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, "ru"));
  }, []);

  const filteredRows = useMemo(() => {
    const needle = normalize(query);
    return tenderCalendarData.calendar.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (dateFilter === "h2" && !isH2Date(row.tenderDate)) return false;
      if (dateFilter === "renewals" && !is2026Date(row.contractEnd)) return false;
      if (dateFilter === "top20" && !row.top20) return false;
      if (!needle) return true;
      return [
        row.id,
        row.customer,
        row.title,
        row.service,
        row.status,
        row.source,
        row.contractNumber,
        row.manager,
        row.notes,
      ].some((value) => normalize(value).includes(needle));
    });
  }, [query, dateFilter, statusFilter]);

  const currentRows = activeTab === "registry"
    ? filteredRows
    : activeTab === "contracts"
      ? tenderCalendarData.samrukContracts
      : activeTab === "top20"
        ? tenderCalendarData.top20Audit
        : [];
  const pagination = getPagination(currentRows.length, page, pageSize);
  const visibleRows = currentRows.slice(pagination.startIndex, pagination.endIndex);

  function resetPage() {
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Календарь"
        description="Сводный календарь тендеров, договоров и будущих перезаключений"
        actions={
          <a
            href={tenderCalendarData.xlsxPath}
            download
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm shadow-emerald-900/10 transition duration-200 hover:-translate-y-0.5 hover:opacity-95 active:translate-y-0"
          >
            <Download className="h-4 w-4" />
            Скачать XLSX
          </a>
        }
      />

      <main className="space-y-5 bg-[#f7faf8] p-8">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={TableProperties} label="Строк в календаре" value={fmtN(tenderCalendarData.metrics.final_count)} detail="после слияния" />
          <MetricCard icon={BadgeCheck} label="Топ-20" value={fmtN(countTop20())} detail="флаг проставлен" accent="amber" />
          <MetricCard icon={Clock3} label="H2 2026" value={fmtN(tenderCalendarData.metrics.h2_2026)} detail="видно фильтром по датам" accent="blue" />
          <MetricCard icon={ShieldCheck} label="Договоры Самрук" value={fmtN(tenderCalendarData.metrics.samruk_contracts)} detail="отдельная вкладка" accent="emerald" />
        </section>

        <section className="rounded-xl border border-emerald-100 bg-white p-4 shadow-[0_18px_50px_rgba(15,78,58,0.07)]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetPage();
                }}
                placeholder="Поиск по заказчику, предмету, договору или источнику"
                className="h-11 w-full rounded-lg border border-emerald-100 bg-[#fbfdfb] pl-10 pr-3 text-sm outline-none transition duration-200 placeholder:text-muted-foreground/70 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
              />
            </div>
            <select
              value={dateFilter}
              onChange={(event) => {
                setDateFilter(event.target.value as DateFilter);
                resetPage();
              }}
              className="h-11 rounded-lg border border-emerald-100 bg-[#fbfdfb] px-3 text-sm outline-none transition duration-200 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
            >
              {dateFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                resetPage();
              }}
              className="h-11 min-w-56 rounded-lg border border-emerald-100 bg-[#fbfdfb] px-3 text-sm outline-none transition duration-200 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
            >
              <option value="all">Все статусы</option>
              {statuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-[0_22px_70px_rgba(15,78,58,0.08)]">
          <div className="border-b border-emerald-100 bg-gradient-to-r from-white via-emerald-50/60 to-white p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(tabLabels) as CalendarTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveTab(tab);
                      resetPage();
                    }}
                    className={`rounded-lg px-3.5 py-2 text-sm font-medium transition duration-200 ${
                      activeTab === tab
                        ? "bg-primary text-primary-foreground shadow-sm shadow-emerald-900/15"
                        : "text-muted-foreground hover:bg-white hover:text-foreground hover:shadow-sm"
                    }`}
                  >
                    {tabLabels[tab]}
                  </button>
                ))}
              </div>

              {activeTab !== "control" && (
                <PaginationToolbar
                  page={pagination.page}
                  pageCount={pagination.pageCount}
                  pageSize={pageSize}
                  total={currentRows.length}
                  startIndex={pagination.startIndex}
                  endIndex={pagination.endIndex}
                  onPageChange={setPage}
                  onPageSizeChange={(value) => {
                    setPageSize(value);
                    setPage(1);
                  }}
                />
              )}
            </div>
          </div>

          {activeTab === "registry" && <RegistryTable rows={visibleRows as CalendarRow[]} />}
          {activeTab === "contracts" && <ContractsTable rows={visibleRows as SamrukContract[]} />}
          {activeTab === "top20" && <Top20Table rows={visibleRows as Top20Row[]} />}
          {activeTab === "control" && <ControlPanel />}

          {activeTab !== "control" && (
            <div className="border-t border-emerald-100 bg-[#fbfdfb] px-4 py-3">
              <PaginationToolbar
                compact
                page={pagination.page}
                pageCount={pagination.pageCount}
                pageSize={pageSize}
                total={currentRows.length}
                startIndex={pagination.startIndex}
                endIndex={pagination.endIndex}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                  setPageSize(value);
                  setPage(1);
                }}
              />
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function RegistryTable({ rows }: { rows: readonly CalendarRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1500px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[#eef7f2] text-[11px] uppercase tracking-wide text-emerald-900/70">
          <tr>
            <Th>ID</Th>
            <Th>Дата</Th>
            <Th>Заказчик</Th>
            <Th>Предмет</Th>
            <Th>Сумма</Th>
            <Th>Статус</Th>
            <Th>Топ-20</Th>
            <Th>Срок договора</Th>
            <Th>Следующий тендер</Th>
            <Th>Ответственный</Th>
            <Th>Источник</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.id}-${row.contractNumber}-${row.title}`} className="group border-t border-emerald-100/80 odd:bg-[#fbfdfb] transition duration-200 hover:bg-emerald-50/70">
              <Td className="whitespace-nowrap font-medium text-foreground">{row.id}</Td>
              <Td className="whitespace-nowrap tabular-nums">{fmtDate(row.tenderDate)}</Td>
              <Td className="max-w-72 leading-relaxed">
                <p className="line-clamp-3" title={row.customer}>{row.customer}</p>
              </Td>
              <Td className="max-w-96">
                <p className="line-clamp-2 font-semibold leading-snug text-foreground transition group-hover:text-primary">{row.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.service || "Без категории"}</p>
              </Td>
              <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtMoney(row.initialAmount || row.contractAmount)}</Td>
              <Td><StatusPill value={row.status} /></Td>
              <Td>{row.top20 ? <YesPill /> : <span className="text-muted-foreground">Нет</span>}</Td>
              <Td>{fmtDate(row.contractEnd)}</Td>
              <Td>{fmtDate(row.nextTenderDate)}</Td>
              <Td>{row.manager || "Не назначен"}</Td>
              <Td className="max-w-64 text-xs text-muted-foreground">{row.source}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyState />}
    </div>
  );
}

function ContractsTable({ rows }: { rows: readonly SamrukContract[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1280px] text-left text-sm">
        <thead className="bg-[#eef7f2] text-[11px] uppercase tracking-wide text-emerald-900/70">
          <tr>
            <Th>Заказчик</Th>
            <Th>Предмет</Th>
            <Th>Сумма</Th>
            <Th>Срок действия</Th>
            <Th>Статус</Th>
            <Th>Ответственный</Th>
            <Th>Документ</Th>
            <Th>Номер договора</Th>
            <Th>Дата заключения</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.contractNumber}-${row.customer}`} className="group border-t border-emerald-100/80 odd:bg-[#fbfdfb] transition duration-200 hover:bg-emerald-50/70">
              <Td className="max-w-80 font-semibold leading-relaxed text-foreground">
                <p className="line-clamp-3" title={row.customer}>{row.customer}</p>
              </Td>
              <Td className="max-w-96 leading-relaxed">
                <p className="line-clamp-3" title={row.subject}>{row.subject}</p>
              </Td>
              <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtMoney(row.amount)}</Td>
              <Td>{fmtDate(row.validUntil)}</Td>
              <Td><StatusPill value={row.status} /></Td>
              <Td>{row.owner}</Td>
              <Td>
                {row.documentUrl ? (
                  <a href={row.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Открыть <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : "—"}
              </Td>
              <Td>{row.contractNumber}</Td>
              <Td>{fmtDate(row.signedAt)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Top20Table({ rows }: { rows: readonly Top20Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1320px] text-left text-sm">
        <thead className="bg-orange-600 text-[11px] uppercase tracking-wide text-white">
          <tr>
            <Th>№ объявления</Th>
            <Th>№ лота</Th>
            <Th>Публикация</Th>
            <Th>Подача до</Th>
            <Th>Предмет</Th>
            <Th>Стоимость</Th>
            <Th>Организатор</Th>
            <Th>Статус</Th>
            <Th>Ссылка</Th>
            <Th>Слияние</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.announcement}-${row.lot}`} className="group border-t border-orange-100 odd:bg-orange-50/40 transition duration-200 hover:bg-orange-50">
              <Td className="font-medium tabular-nums">{row.announcement}</Td>
              <Td className="tabular-nums">{row.lot}</Td>
              <Td className="whitespace-nowrap tabular-nums">{fmtDate(row.publishedAt)}</Td>
              <Td className="whitespace-nowrap tabular-nums">{fmtDate(row.deadlineAt)}</Td>
              <Td className="max-w-96 font-semibold leading-snug text-foreground transition group-hover:text-orange-700">
                <p className="line-clamp-3" title={row.title}>{row.title}</p>
              </Td>
              <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtMoney(row.amount)}</Td>
              <Td className="max-w-80">
                <p className="line-clamp-3" title={row.organizer}>{row.organizer}</p>
              </Td>
              <Td><StatusPill value={row.status} /></Td>
              <Td>
                {row.url ? (
                  <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Источник <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : "—"}
              </Td>
              <Td className="max-w-64 text-xs text-muted-foreground">{row.mergeResult}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ControlPanel() {
  return (
    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {tenderCalendarData.control.map((item) => (
        <div key={item.label} className="rounded-xl border border-emerald-100 bg-[#fbfdfb] p-4 transition duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_35px_rgba(15,78,58,0.08)]">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-900/60">{item.label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{String(item.value)}</p>
        </div>
      ))}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <FileSpreadsheet className="mb-3 h-5 w-5" />
        <p className="font-semibold">Файл для приемки</p>
        <a href={tenderCalendarData.xlsxPath} download className="mt-2 inline-flex items-center gap-1 text-emerald-800 underline">
          Скачать обновленный Excel <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent = "primary",
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  detail: string;
  accent?: "primary" | "amber" | "blue" | "emerald";
}) {
  const accentClass = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
  }[accent];
  return (
    <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-[0_16px_45px_rgba(15,78,58,0.06)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_55px_rgba(15,78,58,0.09)]">
      <div className="flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accentClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function PaginationToolbar({
  page,
  pageCount,
  pageSize,
  total,
  startIndex,
  endIndex,
  compact = false,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  startIndex: number;
  endIndex: number;
  compact?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pages = getVisiblePages(page, pageCount);

  return (
    <div className={`flex flex-col gap-3 text-sm text-muted-foreground ${compact ? "xl:flex-row xl:items-center xl:justify-between" : "lg:flex-row lg:items-center"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="tabular-nums">
          {total > 0 ? `${fmtN(startIndex + 1)}-${fmtN(endIndex)} из ${fmtN(total)}` : "0 строк"}
        </span>
        {!compact && (
          <label className="inline-flex items-center gap-2">
            <span>На странице</span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-9 rounded-lg border border-emerald-100 bg-white px-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-1">
        <PaginationButton
          label="Назад"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </PaginationButton>
        {pages.map((item, index) => (
          item === "gap" ? (
            <span key={`gap-${index}`} className="px-2 text-muted-foreground/60">...</span>
          ) : (
            <button
              key={item}
              onClick={() => onPageChange(item)}
              className={`h-9 min-w-9 rounded-lg px-3 text-sm font-medium tabular-nums transition duration-200 ${
                item === page
                  ? "bg-primary text-primary-foreground shadow-sm shadow-emerald-900/15"
                  : "bg-white text-foreground ring-1 ring-emerald-100 hover:bg-emerald-50"
              }`}
            >
              {item}
            </button>
          )
        ))}
        <PaginationButton
          label="Вперед"
          disabled={page >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </PaginationButton>
      </div>
    </div>
  );
}

function PaginationButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-foreground ring-1 ring-emerald-100 transition duration-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-semibold">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}

function StatusPill({ value }: { value: string }) {
  const normalized = normalize(value);
  const className = normalized.includes("заключ")
    ? "bg-emerald-50 text-emerald-700"
    : normalized.includes("план")
      ? "bg-blue-50 text-blue-700"
      : normalized.includes("выиг")
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>{value || "—"}</span>;
}

function YesPill() {
  return <span className="inline-flex rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">Да</span>;
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Search className="h-4 w-4" />
      Ничего не найдено
    </div>
  );
}

function fmtMoney(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `₸ ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)}`;
}

function fmtN(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU");
}

function isH2Date(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00`);
  return date.getFullYear() === 2026 && date.getMonth() >= 6 && date.getMonth() <= 11;
}

function is2026Date(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00`);
  return date.getFullYear() === 2026;
}

function normalize(value: string | number | null | undefined) {
  return String(value ?? "").toLowerCase().replace(/ё/g, "е").trim();
}

function countTop20() {
  return tenderCalendarData.calendar.filter((row) => row.top20).length;
}

function getPagination(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const startIndex = total === 0 ? 0 : (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);
  return { page: safePage, pageCount, startIndex, endIndex };
}

function getVisiblePages(page: number, pageCount: number) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages: Array<number | "gap"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);

  if (start > 2) pages.push("gap");
  for (let item = start; item <= end; item += 1) pages.push(item);
  if (end < pageCount - 1) pages.push("gap");
  pages.push(pageCount);

  return pages;
}
