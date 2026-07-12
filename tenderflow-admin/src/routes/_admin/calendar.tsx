import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FilterX,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TableProperties,
} from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { tenderCalendarData } from "@/data/tender-calendar";

export const Route = createFileRoute("/_admin/calendar")({
  component: TenderCalendar,
});

type CalendarTab = "registry" | "contracts" | "top20" | "control";
type CalendarMode = "tenders" | "contracts";
type DateFilter = "all" | "h2" | "renewals" | "top20";
type DateField = "publishedAt" | "deadlineAt" | "openingAt";
type CalendarRow = (typeof tenderCalendarData.calendar)[number];
type SamrukContract = (typeof tenderCalendarData.samrukContracts)[number];
type Top20Row = (typeof tenderCalendarData.top20Audit)[number];

const pageSizeOptions = [10, 25, 50, 100];

const dateFieldOptions: { value: DateField; label: string }[] = [
  { value: "publishedAt", label: "Дата публикации" },
  { value: "deadlineAt", label: "Срок подачи" },
  { value: "openingAt", label: "Вскрытие / итоги" },
];

const tenderTabLabels: Record<Exclude<CalendarTab, "contracts">, string> = {
  registry: "Общий календарь",
  top20: "Топ 20",
  control: "Контроль",
};

const tenderDateFilters: { value: DateFilter; label: string }[] = [
  { value: "all", label: "Все даты" },
  { value: "h2", label: "Июль-декабрь 2026" },
  { value: "renewals", label: "Окончание договора 2026" },
  { value: "top20", label: "Только Топ-20" },
];

const contractDateFilters: { value: DateFilter; label: string }[] = [
  { value: "all", label: "Все сроки" },
  { value: "renewals", label: "Срок в 2026" },
  { value: "h2", label: "Срок июль-декабрь 2026" },
];

function TenderCalendar() {
  const [activeTab, setActiveTab] = useState<CalendarTab>("registry");
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [dateField, setDateField] = useState<DateField>("deadlineAt");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountFrom, setAmountFrom] = useState("");
  const [amountTo, setAmountTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const activeMode: CalendarMode = activeTab === "contracts" ? "contracts" : "tenders";
  const activeDateFilters = activeMode === "contracts" ? contractDateFilters : tenderDateFilters;

  const statuses = useMemo(() => {
    const values = new Set<string>();
    const sourceRows = activeTab === "contracts"
      ? tenderCalendarData.samrukContracts
      : activeTab === "top20"
        ? tenderCalendarData.top20Audit
        : tenderCalendarData.calendar;
    sourceRows.forEach((row) => {
      if (row.status) values.add(row.status);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, "ru"));
  }, [activeTab]);

  const filteredCalendarRows = useMemo(() => {
    const needle = normalize(query);
    return tenderCalendarData.calendar.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (dateFilter === "h2" && ![row.publishedAt, row.deadlineAt, row.openingAt, row.nextTenderDate].some(isH2Date)) return false;
      if (dateFilter === "renewals" && !is2026Date(row.contractEnd)) return false;
      if (dateFilter === "top20" && !row.top20) return false;
      if (!matchesDateRange(row[dateField], dateFrom, dateTo)) return false;
      if (!matchesAmountRange(getCalendarAmount(row), amountFrom, amountTo)) return false;
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
    }).sort(compareCalendarDeadline);
  }, [query, dateFilter, dateField, dateFrom, dateTo, amountFrom, amountTo, statusFilter]);

  const filteredContracts = useMemo(() => {
    const needle = normalize(query);
    return tenderCalendarData.samrukContracts.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (dateFilter === "h2" && !isH2Date(row.validUntil)) return false;
      if (dateFilter === "renewals" && !is2026Date(row.validUntil)) return false;
      if (!matchesDateRange(row.validUntil, dateFrom, dateTo)) return false;
      if (!matchesAmountRange(row.amount, amountFrom, amountTo)) return false;
      if (!needle) return true;
      return [
        row.customer,
        row.subject,
        row.status,
        row.owner,
        row.documentUrl,
        row.contractNumber,
        row.supplier,
        row.purchaseMethod,
      ].some((value) => normalize(value).includes(needle));
    }).sort((left, right) => compareNearestDate(left.validUntil, right.validUntil));
  }, [query, dateFilter, dateFrom, dateTo, amountFrom, amountTo, statusFilter]);

  const filteredTop20Rows = useMemo(() => {
    const needle = normalize(query);
    return tenderCalendarData.top20Audit.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (dateFilter === "h2" && !isH2Date(row.publishedAt) && !isH2Date(row.deadlineAt)) return false;
      const selectedDate = dateField === "deadlineAt" ? row.deadlineAt : row.publishedAt;
      if (!matchesDateRange(selectedDate, dateFrom, dateTo)) return false;
      if (!matchesAmountRange(row.amount, amountFrom, amountTo)) return false;
      if (!needle) return true;
      return [
        row.announcement,
        row.lot,
        row.title,
        row.organizer,
        row.status,
        row.url,
        row.mergeResult,
      ].some((value) => normalize(value).includes(needle));
    }).sort((left, right) => compareNearestDate(left.deadlineAt, right.deadlineAt));
  }, [query, dateFilter, dateField, dateFrom, dateTo, amountFrom, amountTo, statusFilter]);

  const currentRows = activeTab === "registry"
    ? filteredCalendarRows
    : activeTab === "contracts"
      ? filteredContracts
      : activeTab === "top20"
        ? filteredTop20Rows
        : [];
  const pagination = getPagination(currentRows.length, page, pageSize);
  const visibleRows = currentRows.slice(pagination.startIndex, pagination.endIndex);

  function resetPage() {
    setPage(1);
  }

  function resetFilters() {
    setQuery("");
    setDateFilter("all");
    setDateField("deadlineAt");
    setDateFrom("");
    setDateTo("");
    setAmountFrom("");
    setAmountTo("");
    setStatusFilter("all");
    setPage(1);
  }

  function switchMode(mode: CalendarMode) {
    setActiveTab(mode === "contracts" ? "contracts" : "registry");
    resetFilters();
  }

  function switchTenderTab(tab: Exclude<CalendarTab, "contracts">) {
    setActiveTab(tab);
    setDateFilter("all");
    if (tab === "top20" && dateField === "openingAt") setDateField("publishedAt");
    setStatusFilter("all");
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Календарь"
        description="Календарь тендеров отделен от реестра договоров Самрук-Казына"
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
        <section className="grid gap-3 xl:grid-cols-2">
          <ModeButton
            active={activeMode === "tenders"}
            icon={CalendarDays}
            title="Календарь тендеров"
            meta={`${fmtN(tenderCalendarData.metrics.final_count)} строк`}
            description="Общий список после слияния, флаг Топ-20 и будущие перезаключения."
            onClick={() => switchMode("tenders")}
          />
          <ModeButton
            active={activeMode === "contracts"}
            icon={ShieldCheck}
            title="Договора Самрук-Казына"
            meta={`${fmtN(tenderCalendarData.samrukContracts.length)} договоров`}
            description="Отдельный реестр договоров: заказчик, предмет, сумма, срок, статус, ответственный и документ."
            onClick={() => switchMode("contracts")}
          />
        </section>

        {activeMode === "tenders" ? (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={TableProperties} label="Строк в календаре" value={fmtN(tenderCalendarData.metrics.final_count)} detail="после слияния" />
            <MetricCard icon={BadgeCheck} label="Топ-20" value={fmtN(countTop20())} detail="флаг проставлен" accent="amber" />
            <MetricCard icon={Clock3} label="H2 2026" value={fmtN(tenderCalendarData.metrics.h2_2026)} detail="видно фильтром по датам" accent="blue" />
            <MetricCard icon={CalendarDays} label="Перезаключения" value={fmtN(tenderCalendarData.metrics.renewals_2026)} detail="по окончанию договоров 2026" accent="emerald" />
          </section>
        ) : (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={ShieldCheck} label="Договоры Самрук" value={fmtN(tenderCalendarData.samrukContracts.length)} detail="отдельный реестр" accent="emerald" />
            <MetricCard icon={TableProperties} label="Сумма договоров" value={fmtMoneyShort(sumContracts())} detail="по текущему источнику" />
            <MetricCard icon={Clock3} label="Срок в 2026" value={fmtN(countContracts2026())} detail="видно фильтром по срокам" accent="blue" />
            <MetricCard icon={FileSpreadsheet} label="Ссылки на документы" value={fmtN(countContractLinks())} detail="SharePoint / площадка" accent="amber" />
          </section>
        )}

        {activeTab !== "control" && (
          <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-[0_18px_50px_rgba(15,78,58,0.07)]">
            <div className="flex items-center gap-2 border-b border-emerald-100 bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-emerald-950">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Фильтры реестра
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {fmtN(currentRows.length)} строк найдено
              </span>
            </div>
            <div className="grid gap-3 p-4 xl:grid-cols-[minmax(280px,1fr)_220px_220px]">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    resetPage();
                  }}
                  placeholder={activeMode === "contracts" ? "Поиск по заказчику, предмету, договору или документу" : "Поиск по заказчику, предмету, договору или источнику"}
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
                {activeDateFilters.map((filter) => (
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
            <div className="grid gap-3 border-t border-emerald-100 px-4 py-4 md:grid-cols-2 xl:grid-cols-[200px_minmax(280px,1fr)_minmax(280px,1fr)_40px]">
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                Поле даты
                {activeMode === "contracts" ? (
                  <div className="flex h-10 items-center rounded-lg border border-emerald-100 bg-[#fbfdfb] px-3 text-sm text-foreground">
                    Срок действия договора
                  </div>
                ) : (
                  <select
                    value={dateField}
                    onChange={(event) => {
                      setDateField(event.target.value as DateField);
                      resetPage();
                    }}
                    className="h-10 rounded-lg border border-emerald-100 bg-[#fbfdfb] px-3 text-sm text-foreground outline-none transition duration-200 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                  >
                    {dateFieldOptions
                      .filter((option) => activeTab !== "top20" || option.value !== "openingAt")
                      .map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                  </select>
                )}
              </label>

              <div className="grid grid-cols-2 gap-2">
                <FilterInput
                  label="Дата с"
                  type="date"
                  value={dateFrom}
                  onChange={(value) => {
                    setDateFrom(value);
                    resetPage();
                  }}
                />
                <FilterInput
                  label="Дата по"
                  type="date"
                  value={dateTo}
                  onChange={(value) => {
                    setDateTo(value);
                    resetPage();
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <FilterInput
                  label={activeMode === "contracts" ? "Сумма от" : "НМЦ от"}
                  type="number"
                  value={amountFrom}
                  placeholder="0"
                  onChange={(value) => {
                    setAmountFrom(value);
                    resetPage();
                  }}
                />
                <FilterInput
                  label={activeMode === "contracts" ? "Сумма до" : "НМЦ до"}
                  type="number"
                  value={amountTo}
                  placeholder="Без лимита"
                  onChange={(value) => {
                    setAmountTo(value);
                    resetPage();
                  }}
                />
              </div>

              <button
                type="button"
                title="Сбросить фильтры"
                aria-label="Сбросить фильтры"
                onClick={resetFilters}
                className="mt-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-100 bg-white text-foreground transition duration-200 hover:border-emerald-200 hover:bg-emerald-50 focus:outline-none focus:ring-4 focus:ring-primary/10"
              >
                <FilterX className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-[0_22px_70px_rgba(15,78,58,0.08)]">
          <div className="border-b border-emerald-100 bg-gradient-to-r from-white via-emerald-50/60 to-white p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              {activeMode === "tenders" ? (
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(tenderTabLabels) as Array<Exclude<CalendarTab, "contracts">>).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => switchTenderTab(tab)}
                      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition duration-200 ${
                        activeTab === tab
                          ? "bg-primary text-primary-foreground shadow-sm shadow-emerald-900/15"
                          : "text-muted-foreground hover:bg-white hover:text-foreground hover:shadow-sm"
                      }`}
                    >
                      {tenderTabLabels[tab]}
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Отдельная вкладка</p>
                  <h2 className="mt-1 text-base font-semibold text-foreground">Договора Самрук-Казына</h2>
                </div>
              )}

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
      <table className="min-w-[1880px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[#eef7f2] text-[11px] uppercase tracking-wide text-emerald-900/70">
          <tr>
            <Th>ID</Th>
            <Th>Публикация</Th>
            <Th>
              <span className="inline-flex items-center gap-1.5">
                Подача до <ArrowUpDown className="h-3.5 w-3.5" />
              </span>
            </Th>
            <Th>Вскрытие / итоги</Th>
            <Th>Заказчик</Th>
            <Th>Предмет</Th>
            <Th>НМЦ</Th>
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
              <Td className="whitespace-nowrap tabular-nums">{fmtDate(row.publishedAt)}</Td>
              <Td className="whitespace-nowrap font-semibold tabular-nums text-foreground">{fmtDate(row.deadlineAt)}</Td>
              <Td className="whitespace-nowrap tabular-nums">{fmtDate(row.openingAt)}</Td>
              <Td className="max-w-72 leading-relaxed">
                <p className="line-clamp-3" title={row.customer}>{row.customer}</p>
              </Td>
              <Td className="max-w-96">
                <p className="line-clamp-2 font-semibold leading-snug text-foreground transition group-hover:text-primary">{row.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.service || "Без категории"}</p>
              </Td>
              <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtMoney(getCalendarAmount(row))}</Td>
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
      {rows.length === 0 && <EmptyState />}
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
      {rows.length === 0 && <EmptyState />}
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

function ModeButton({
  active,
  icon: Icon,
  title,
  meta,
  description,
  onClick,
}: {
  active: boolean;
  icon: typeof CalendarDays;
  title: string;
  meta: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group rounded-xl border p-5 text-left transition duration-200 ${
        active
          ? "border-primary/30 bg-white shadow-[0_20px_60px_rgba(15,78,58,0.10)]"
          : "border-emerald-100 bg-white/70 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_18px_50px_rgba(15,78,58,0.07)]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg transition duration-200 ${active ? "bg-primary text-primary-foreground" : "bg-emerald-50 text-primary group-hover:bg-primary/10"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {meta}
        </span>
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
    </button>
  );
}

function FilterInput({
  label,
  type,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  type: "date" | "number";
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <input
        type={type}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "1" : undefined}
        inputMode={type === "number" ? "numeric" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-lg border border-emerald-100 bg-[#fbfdfb] px-3 text-sm text-foreground outline-none transition duration-200 placeholder:text-muted-foreground/60 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
      />
    </label>
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

function fmtMoneyShort(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `₸ ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1_000_000_000)} млрд`;
  if (Math.abs(value) >= 1_000_000) return `₸ ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1_000_000)} млн`;
  return fmtMoney(value);
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

function getCalendarAmount(row: CalendarRow) {
  return row.initialAmount ?? row.winnerAmount ?? row.contractAmount;
}

function matchesDateRange(value: string | null | undefined, from: string, to: string) {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function matchesAmountRange(value: number | null | undefined, from: string, to: string) {
  if (!from && !to) return true;
  if (typeof value !== "number" || Number.isNaN(value)) return false;
  const minimum = parseAmountFilter(from);
  const maximum = parseAmountFilter(to);
  if (minimum !== null && value < minimum) return false;
  if (maximum !== null && value > maximum) return false;
  return true;
}

function parseAmountFilter(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function compareCalendarDeadline(left: CalendarRow, right: CalendarRow) {
  const deadlineOrder = compareNearestDate(left.deadlineAt, right.deadlineAt);
  if (deadlineOrder !== 0) return deadlineOrder;
  return compareNearestDate(
    left.publishedAt || left.openingAt || left.tenderDate,
    right.publishedAt || right.openingAt || right.tenderDate,
  );
}

function compareNearestDate(left: string | null | undefined, right: string | null | undefined) {
  const leftRank = getDateRank(left);
  const rightRank = getDateRank(right);
  if (leftRank.bucket !== rightRank.bucket) return leftRank.bucket - rightRank.bucket;
  return leftRank.distance - rightRank.distance;
}

function getDateRank(value: string | null | undefined) {
  if (!value) return { bucket: 2, distance: Number.MAX_SAFE_INTEGER };
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return { bucket: 2, distance: Number.MAX_SAFE_INTEGER };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const distance = Math.round((parsed.getTime() - today.getTime()) / 86_400_000);
  return distance >= 0
    ? { bucket: 0, distance }
    : { bucket: 1, distance: Math.abs(distance) };
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

function sumContracts() {
  return tenderCalendarData.samrukContracts.reduce((sum, row) => sum + (typeof row.amount === "number" ? row.amount : 0), 0);
}

function countContracts2026() {
  return tenderCalendarData.samrukContracts.filter((row) => is2026Date(row.validUntil)).length;
}

function countContractLinks() {
  return tenderCalendarData.samrukContracts.filter((row) => Boolean(row.documentUrl)).length;
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
