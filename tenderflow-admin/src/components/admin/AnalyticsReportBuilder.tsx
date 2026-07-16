import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Banknote,
  Ban,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleOff,
  Download,
  Eye,
  FileText,
  Hash,
  Info,
  Layers3,
  Loader2,
  Repeat2,
  RotateCcw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  analyticsApi,
  type AnalyticsReportBreakdown,
  type AnalyticsReportPreview,
  type AnalyticsReportRequest,
  type AnalyticsReportStatus,
} from "@/lib/analytics-api";

type ReportFormState = {
  organizationQuery: string;
  organization: string;
  platforms: string[];
  dateFrom: string;
  dateTo: string;
  topN: number;
};

const initialForm = (): ReportFormState => ({
  organizationQuery: "",
  organization: "",
  platforms: [],
  dateFrom: `${new Date().getFullYear()}-01-01`,
  dateTo: localISODate(new Date()),
  topN: 15,
});

export function AnalyticsReportBuilder() {
  const [form, setForm] = useState<ReportFormState>(initialForm);
  const [preview, setPreview] = useState<AnalyticsReportPreview | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AnalyticsReportRequest | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [error, setError] = useState("");

  const request = useMemo(() => buildRequest(form), [form]);
  const validationError = validateForm(form);
  const previewIsStale = Boolean(
    previewRequest && requestKey(previewRequest) !== requestKey(request),
  );
  const platformOptions = preview?.available_platforms ?? [];
  const organizationOptions = preview?.available_organizations ?? [];

  const update = <Key extends keyof ReportFormState>(key: Key, value: ReportFormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const submitPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validationError) {
      setError(validationError);
      return;
    }
    setPreviewLoading(true);
    setError("");
    try {
      const data = await analyticsApi.previewReport(request);
      setPreview(data);
      setPreviewRequest(request);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadWord = async () => {
    if (!previewRequest || previewIsStale) return;
    setDownloadLoading(true);
    setError("");
    try {
      const { blob, filename } = await analyticsApi.downloadReportDocx(previewRequest);
      downloadBlob(blob, filename);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setDownloadLoading(false);
    }
  };

  const reset = () => {
    setForm(initialForm());
    setPreview(null);
    setPreviewRequest(null);
    setError("");
  };

  const togglePlatform = (platform: string) => {
    const next = form.platforms.includes(platform)
      ? form.platforms.filter((item) => item !== platform)
      : [...form.platforms, platform];
    update("platforms", next);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-primary/20 bg-card shadow-[0_22px_54px_-42px_rgba(0,132,83,0.7)]">
      <div className="border-b border-primary/15 bg-gradient-to-br from-primary/10 via-card to-card px-5 py-5 lg:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">Аналитическая справка</h2>
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  Word
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                Сформируйте готовую справку напрямую из данных портала и проверьте итоговые
                показатели до выгрузки.
              </p>
            </div>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2 text-xs text-muted-foreground">
            <CalendarDays className="h-4 w-4 text-primary" />
            Период по дате публикации лота
          </div>
        </div>
      </div>

      <form onSubmit={submitPreview} className="space-y-5 p-5 lg:p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
          <Field label="Организация или БИН" className="xl:col-span-4" required>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={form.organizationQuery}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    organizationQuery: event.target.value,
                    organization: "",
                  }));
                  setError("");
                }}
                placeholder="Название или БИН, минимум 2 символа"
                autoComplete="off"
                className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>
          </Field>

          <Field
            label="Точное совпадение"
            className="xl:col-span-3"
            hint={organizationOptions.length === 0 ? "Доступно после предпросмотра" : undefined}
          >
            <select
              value={form.organization}
              onChange={(event) => update("organization", event.target.value)}
              disabled={organizationOptions.length === 0}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground"
            >
              <option value="">Все найденные организации</option>
              {organizationOptions.map((organization) => (
                <option key={organization} value={organization}>
                  {organization}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Период с" className="xl:col-span-2">
            <input
              type="date"
              value={form.dateFrom}
              max={form.dateTo || undefined}
              onChange={(event) => update("dateFrom", event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </Field>

          <Field label="Период по" className="xl:col-span-2">
            <input
              type="date"
              value={form.dateTo}
              min={form.dateFrom || undefined}
              max={localISODate(new Date())}
              onChange={(event) => update("dateTo", event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </Field>

          <Field label="Топ-N" className="xl:col-span-1">
            <input
              type="number"
              min={1}
              max={100}
              value={form.topN}
              onChange={(event) => update("topN", Number(event.target.value))}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-foreground">Площадки</p>
            {platformOptions.length === 0 && (
              <span className="text-[11px] text-muted-foreground">
                Уточнение доступно после первого предпросмотра
              </span>
            )}
          </div>
          <div className="mt-2 flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-input bg-background p-2">
            <button
              type="button"
              onClick={() => update("platforms", [])}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${form.platforms.length === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              Все площадки
            </button>
            {platformOptions.map((platform) => {
              const active = form.platforms.includes(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatform(platform)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${active ? "border-primary/30 bg-primary/10 text-primary" : "border-transparent bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  {platform}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-5">
            Все показатели считаются по <strong>уникальным номерам лотов</strong>. Повторные строки
            и переходы между стадиями не увеличивают итог; возможные переобъявления отмечаются
            отдельно.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 text-xs text-muted-foreground">
            {preview && !previewIsStale && (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Предпросмотр актуален — документ готов к выгрузке
              </span>
            )}
            {previewIsStale && (
              <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                Параметры изменены — обновите предпросмотр
              </span>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              disabled={previewLoading || downloadLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Сбросить
            </button>
            <button
              type="button"
              onClick={downloadWord}
              disabled={!preview || previewIsStale || previewLoading || downloadLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 text-sm font-medium text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloadLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloadLoading ? "Готовим Word…" : "Скачать Word"}
            </button>
            <button
              type="submit"
              disabled={Boolean(validationError) || previewLoading || downloadLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : preview ? (
                <Eye className="h-4 w-4" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {previewLoading
                ? "Считаем уникальные лоты…"
                : preview
                  ? "Обновить предпросмотр"
                  : "Сформировать предпросмотр"}
            </button>
          </div>
        </div>
      </form>

      {previewLoading && !preview && <ReportLoadingState />}
      {preview && <ReportPreview data={preview} stale={previewIsStale} />}
    </section>
  );
}

function ReportPreview({ data, stale }: { data: AnalyticsReportPreview; stale: boolean }) {
  const organization =
    data.header.organization_filter ||
    data.header.organizations.join(", ") ||
    data.header.organization_query;
  const period = formatPeriod(data.header.date_from, data.header.date_to);

  return (
    <div
      className={`border-t border-border bg-muted/15 px-5 py-6 transition lg:px-6 ${stale ? "opacity-70" : ""}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            <Eye className="h-4 w-4" />
            Предпросмотр справки
          </div>
          <h3 className="mt-2 text-lg font-semibold">
            {data.header.title || "Аналитическая справка"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{organization || "Все организации"}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <MetaPill icon={CalendarDays} label={period} />
          <MetaPill
            icon={Layers3}
            label={data.header.platforms.length ? data.header.platforms.join(", ") : "Все площадки"}
          />
          <MetaPill icon={CheckCircle2} label={`Данные на ${formatDate(data.header.data_as_of)}`} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <PreviewKpi
          icon={Hash}
          label="Уникальных лотов"
          value={formatNumber(data.kpis.total_lots)}
          detail={`${formatNumber(data.quality.source_rows)} строк в источнике`}
        />
        <PreviewKpi
          icon={CheckCircle2}
          label="Завершено"
          value={formatNumber(data.kpis.completed_lots)}
          detail="по итоговому статусу"
          tone="green"
        />
        <PreviewKpi
          icon={Ban}
          label="Отменено"
          value={formatNumber(data.kpis.cancelled_lots)}
          detail={`Не состоялось: ${formatNumber(data.kpis.failed_lots)}`}
          tone="red"
        />
        <PreviewKpi
          icon={CircleOff}
          label="Без суммы"
          value={formatNumber(data.kpis.lots_without_amount)}
          detail="не включены в сумму"
          tone="amber"
        />
        <PreviewKpi
          icon={Banknote}
          label="Общая сумма"
          value={formatMoney(data.kpis.total_amount)}
          detail="по уникальным лотам"
          tone="blue"
        />
        <PreviewKpi
          icon={Repeat2}
          label="Переобъявления"
          value={formatNumber(data.kpis.possible_reannouncements)}
          detail="требуют внимания"
          tone="violet"
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <BreakdownTable title="По типу закупки" items={data.by_purchase_type} />
        <BreakdownTable title="По категории услуг" items={data.by_service_category} />
      </div>

      {data.top_tenders.length > 0 && <TopTendersTable data={data} />}

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Conclusions conclusions={data.conclusions} />
        <QualitySummary data={data} />
      </div>

      {data.repeated_lots.length > 0 && <RepeatedLots data={data} />}

      <div className="mt-5 flex flex-col gap-2 rounded-lg border border-border bg-background px-4 py-3 text-xs leading-5 text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
        <span>{data.header.deduplication_method}</span>
        <span className="shrink-0">Сформировано {formatDateTime(data.header.generated_at)}</span>
      </div>
    </div>
  );
}

function BreakdownTable({ title, items }: { title: string; items: AnalyticsReportBreakdown[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">{title}</h4>
        </div>
        <span className="text-xs text-muted-foreground">{formatNumber(items.length)} позиций</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Нет данных для выбранных параметров
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Наименование</th>
                <th className="px-3 py-2.5 text-right font-medium">Лотов</th>
                <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.slice(0, 7).map((item) => (
                <tr key={item.name}>
                  <td className="max-w-[280px] truncate px-4 py-3 font-medium" title={item.name}>
                    {item.name || "Не указано"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                    {formatNumber(item.count)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatMoney(item.amount)}
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

function TopTendersTable({ data }: { data: AnalyticsReportPreview }) {
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Крупнейшие тендеры по сумме</h4>
        </div>
        <span className="text-xs text-muted-foreground">
          Показано {formatNumber(data.top_tenders.length)}
        </span>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">№ лота</th>
              <th className="px-4 py-2.5 font-medium">Наименование</th>
              <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
              <th className="px-4 py-2.5 font-medium">Срок</th>
              <th className="px-4 py-2.5 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.top_tenders.map((tender) => (
              <tr
                key={`${tender.lot_source || tender.platform}-${tender.lot_number}`}
                className="align-top"
              >
                <td className="px-4 py-3">
                  <div className="font-mono text-xs font-semibold">{tender.lot_number || "—"}</div>
                  {tender.possible_reannouncement && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-200">
                      <Repeat2 className="h-3 w-3" /> переобъявление
                    </span>
                  )}
                </td>
                <td className="max-w-[420px] px-4 py-3">
                  <p className="line-clamp-2 font-medium leading-5" title={tender.title}>
                    {tender.title || "Без наименования"}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {tender.organization || tender.platform}
                  </p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                  {formatMoney(tender.amount, tender.amount_available)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatDate(tender.deadline)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge group={tender.status_group} label={tender.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Conclusions({ conclusions }: { conclusions: string[] }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">Краткие выводы</h4>
      </div>
      {conclusions.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Для выбранного периода недостаточно данных для выводов.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {conclusions.map((conclusion, index) => (
            <li key={`${index}-${conclusion}`} className="flex gap-3 text-sm leading-5">
              <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {index + 1}
              </span>
              <span>{conclusion}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QualitySummary({ data }: { data: AnalyticsReportPreview }) {
  const quality = data.quality;
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">Контроль качества данных</h4>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <QualityMetric label="Строк после фильтра" value={quality.filtered_rows} />
        <QualityMetric label="Уникальных лотов" value={quality.unique_lots} />
        <QualityMetric label="Без номера лота" value={quality.rows_without_lot_number} />
        <QualityMetric label="Спорные суммы" value={quality.lots_with_conflicting_amounts} />
      </div>
      {(quality.warnings?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100">
          {quality.warnings?.slice(0, 2).join(" ")}
        </div>
      )}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {data.header.amount_calculation_note}
      </p>
    </section>
  );
}

function RepeatedLots({ data }: { data: AnalyticsReportPreview }) {
  return (
    <section className="mt-5 rounded-lg border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/70 dark:bg-violet-950/20">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Repeat2 className="h-4 w-4 text-violet-700 dark:text-violet-300" />
          <h4 className="text-sm font-semibold">Лоты с повторными публикациями</h4>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatNumber(data.repeated_lots.length)} записей для проверки
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {data.repeated_lots.slice(0, 6).map((lot) => (
          <div
            key={`${lot.lot_source || lot.platform}-${lot.lot_number}`}
            className="rounded-lg border border-violet-200/80 bg-background px-3 py-3 dark:border-violet-900/60"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold">{lot.lot_number}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={lot.title}>
                  {lot.title || lot.platform}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-violet-100 px-2 py-1 text-[10px] font-semibold text-violet-800 dark:bg-violet-900/60 dark:text-violet-100">
                {formatNumber(lot.publication_count)} публ.
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportLoadingState() {
  return (
    <div className="border-t border-border bg-muted/15 px-5 py-8 lg:px-6" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div>
          <p className="text-sm font-semibold">Собираем справку</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Фильтруем строки, исключаем дубликаты и рассчитываем итоговые суммы.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 flex min-h-4 items-center justify-between gap-2 text-xs font-medium text-foreground">
        <span>
          {label}
          {required && <span className="ml-1 text-red-600">*</span>}
        </span>
        {hint && (
          <span className="truncate text-[10px] font-normal text-muted-foreground">{hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}

function PreviewKpi({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "green" | "red" | "amber" | "blue" | "violet";
}) {
  const tones = {
    default: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200",
    red: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-200",
  };
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-4">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function MetaPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function StatusBadge({ group, label }: { group: AnalyticsReportStatus; label: string }) {
  const classes: Record<string, string> = {
    completed:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
    cancelled:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200",
    failed:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    active:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200",
    unknown: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${classes[group] || classes.unknown}`}
    >
      {label || "Без статуса"}
    </span>
  );
}

function QualityMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="text-[10px] leading-4 text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatNumber(value)}</p>
    </div>
  );
}

function buildRequest(form: ReportFormState): AnalyticsReportRequest {
  return {
    organization_query: form.organizationQuery.trim(),
    ...(form.organization ? { organization: form.organization } : {}),
    ...(form.platforms.length ? { platforms: [...form.platforms].sort() } : {}),
    ...(form.dateFrom ? { date_from: form.dateFrom } : {}),
    ...(form.dateTo ? { date_to: form.dateTo } : {}),
    top_n: form.topN,
  };
}

function validateForm(form: ReportFormState): string {
  if (form.organizationQuery.trim().length < 2)
    return "Введите организацию или БИН — минимум 2 символа";
  if (form.dateFrom && form.dateTo && form.dateFrom > form.dateTo)
    return "Дата начала периода не может быть позже даты окончания";
  if (!Number.isInteger(form.topN) || form.topN < 1 || form.topN > 100)
    return "Top-N должен быть целым числом от 1 до 100";
  return "";
}

function requestKey(request: AnalyticsReportRequest): string {
  return JSON.stringify(request);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatMoney(value: number, available = true): string {
  if (!available) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value) || 0)} тг`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const plain = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (plain) return `${plain[3]}.${plain[2]}.${plain[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPeriod(from?: string, to?: string): string {
  if (from && to) return `${formatDate(from)} — ${formatDate(to)}`;
  if (from) return `с ${formatDate(from)}`;
  if (to) return `по ${formatDate(to)}`;
  return "За весь период";
}

function localISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readableError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught || "");
  try {
    const parsed = JSON.parse(message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // keep the original message
  }
  return message.replace(/^"|"$/g, "") || "Не удалось сформировать справку. Повторите попытку.";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "analytics-report.docx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
