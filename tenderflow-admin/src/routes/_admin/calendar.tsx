import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
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

  return (
    <>
      <PageHeader
        title="Календарь"
        description="Сводный календарь тендеров, договоров и будущих перезаключений"
        actions={
          <a
            href={tenderCalendarData.xlsxPath}
            download
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Скачать XLSX
          </a>
        }
      />

      <main className="space-y-5 p-8">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={TableProperties} label="Строк в календаре" value={fmtN(tenderCalendarData.metrics.final_count)} detail="после слияния" />
          <MetricCard icon={BadgeCheck} label="Топ-20" value={fmtN(countTop20())} detail="флаг проставлен" accent="amber" />
          <MetricCard icon={Clock3} label="H2 2026" value={fmtN(tenderCalendarData.metrics.h2_2026)} detail="видно фильтром по датам" accent="blue" />
          <MetricCard icon={ShieldCheck} label="Договоры Самрук" value={fmtN(tenderCalendarData.metrics.samruk_contracts)} detail="отдельная вкладка" accent="emerald" />
        </section>

        <section className="rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по заказчику, предмету, договору или источнику"
                className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>
            <select
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value as DateFilter)}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              {dateFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 min-w-56 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="all">Все статусы</option>
              {statuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            {(Object.keys(tabLabels) as CalendarTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  activeTab === tab
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>

          {activeTab === "registry" && <RegistryTable rows={filteredRows} />}
          {activeTab === "contracts" && <ContractsTable rows={tenderCalendarData.samrukContracts} />}
          {activeTab === "top20" && <Top20Table rows={tenderCalendarData.top20Audit} />}
          {activeTab === "control" && <ControlPanel />}
        </section>
      </main>
    </>
  );
}

function RegistryTable({ rows }: { rows: readonly CalendarRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1500px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-muted/80 text-xs uppercase tracking-wide text-muted-foreground">
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
            <tr key={`${row.id}-${row.contractNumber}-${row.title}`} className="border-t border-border odd:bg-muted/30">
              <Td className="font-medium text-foreground">{row.id}</Td>
              <Td>{fmtDate(row.tenderDate)}</Td>
              <Td className="max-w-72">{row.customer}</Td>
              <Td className="max-w-96">
                <p className="font-medium text-foreground">{row.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.service || "Без категории"}</p>
              </Td>
              <Td className="whitespace-nowrap text-right font-medium">{fmtMoney(row.initialAmount || row.contractAmount)}</Td>
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
        <thead className="bg-muted/80 text-xs uppercase tracking-wide text-muted-foreground">
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
            <tr key={`${row.contractNumber}-${row.customer}`} className="border-t border-border odd:bg-muted/30">
              <Td className="max-w-80 font-medium text-foreground">{row.customer}</Td>
              <Td className="max-w-96">{row.subject}</Td>
              <Td className="whitespace-nowrap text-right font-medium">{fmtMoney(row.amount)}</Td>
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
        <thead className="bg-orange-600 text-xs uppercase tracking-wide text-white">
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
            <tr key={`${row.announcement}-${row.lot}`} className="border-t border-border odd:bg-orange-50/50">
              <Td>{row.announcement}</Td>
              <Td>{row.lot}</Td>
              <Td>{fmtDate(row.publishedAt)}</Td>
              <Td>{fmtDate(row.deadlineAt)}</Td>
              <Td className="max-w-96 font-medium text-foreground">{row.title}</Td>
              <Td className="whitespace-nowrap text-right font-medium">{fmtMoney(row.amount)}</Td>
              <Td className="max-w-80">{row.organizer}</Td>
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
        <div key={item.label} className="rounded-lg border border-border bg-background p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{String(item.value)}</p>
        </div>
      ))}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
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
    <div className="rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-3 font-semibold">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 align-top ${className}`}>{children}</td>;
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
