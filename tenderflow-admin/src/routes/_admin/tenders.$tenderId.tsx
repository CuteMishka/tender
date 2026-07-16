import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { TenderAssistantChat } from "@/components/admin/TenderAssistantChat";
import {
  ArrowLeft, ExternalLink, FileText, Sparkles,
  ThumbsUp, ThumbsDown, Calendar, Building2, MapPin,
  Hash, DollarSign, Clock, Download, History, Loader2,
  UploadCloud, Send, MessageSquare, ListTodo, Plus, CheckCircle2, Circle,
} from "lucide-react";
import { analyticsApi, fmtDate, fmtM, type HistoricalLot } from "@/lib/analytics-api";
import { apiFetch } from "@/lib/api-client";
import {
  autoExtractTenderSpecSummary,
  buildLotText,
  createTenderComment,
  createTenderTask,
  fetchDocumentBlobViaBackendProxy,
  fetchLotAnalyze,
  fetchTenderActivity,
  fetchTenderById,
  fetchTenderComments,
  fetchTenderTasks,
  formatDate,
  formatTenderAmount,
  getLocalApiBase,
  getTenderSpecCache,
  getTenderStatus,
  markTenderViewed,
  markTenderDecision,
  getTenderViewInfo,
  pickTenderDocumentForRag,
  saveTenderSpecCache,
  savedLotStatusLabels,
  sanitizeApiText,
  sanitizeApiTextMultiline,
  tenderCompanyName,
  tenderSourceLabel,
  updateTenderTask,
  type LotAnalyzeResult,
  type LotSpecService,
  type LotSpecSummary,
  type TenderActivity,
  type TenderComment,
  type TenderDocument,
  type TenderItem,
  type TenderTask,
  type TenderViewInfo,
} from "@/lib/tenders-api";
import { pushNotification } from "@/hooks/use-notifications";
import { getCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/_admin/tenders/$tenderId")({
  ssr: false,
  component: TenderDetail,
});

function blockText(s: string) {
  return sanitizeApiText(s) || "—";
}

function sourceBadgeClass(source?: string | null): string {
  switch ((source || "").toLowerCase()) {
    case "samruk":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "zakup":
    case "goszakup":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

function specText(s: string | undefined) {
  if (!s) return "";
  return sanitizeApiTextMultiline(s);
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBlobFile(filename: string, blob: Blob) {
  if (blob.size === 0) {
    throw new Error("Площадка вернула пустой файл. Попробуйте скачать другой документ или повторите позже.");
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function tenderDocumentDownloadKey(doc: TenderDocument): string {
  return `${doc.downloadLink.trim()}\n${doc.name.trim()}`;
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-sm text-foreground">{value || "—"}</dd>
      </div>
    </div>
  );
}

type DetailMetricTone = "blue" | "green" | "amber" | "teal" | "red" | "slate";

const detailMetricTone: Record<DetailMetricTone, { shell: string; icon: string; bar: string; text: string }> = {
  blue: { shell: "border-blue-100 bg-blue-50/70", icon: "bg-blue-100 text-blue-700", bar: "bg-blue-500", text: "text-blue-700" },
  green: { shell: "border-emerald-100 bg-emerald-50/80", icon: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500", text: "text-emerald-700" },
  amber: { shell: "border-amber-100 bg-amber-50/80", icon: "bg-amber-100 text-amber-800", bar: "bg-amber-500", text: "text-amber-800" },
  teal: { shell: "border-teal-100 bg-teal-50/80", icon: "bg-teal-100 text-teal-700", bar: "bg-teal-500", text: "text-teal-700" },
  red: { shell: "border-red-100 bg-red-50/80", icon: "bg-red-100 text-red-700", bar: "bg-red-500", text: "text-red-700" },
  slate: { shell: "border-border bg-muted/40", icon: "bg-background text-muted-foreground", bar: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

function deadlineLabel(daysLeft: number | null): string {
  if (daysLeft === null) return "без срока";
  if (daysLeft < 0) return "истек";
  if (daysLeft === 0) return "сегодня";
  return `${daysLeft} дн.`;
}

function deadlineTone(color?: string): DetailMetricTone {
  if (color === "red") return "red";
  if (color === "orange") return "amber";
  if (color === "green") return "green";
  return "slate";
}

function DetailMetric({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  progress,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  tone: DetailMetricTone;
  progress?: number;
}) {
  const cls = detailMetricTone[tone];
  return (
    <div className={`overflow-hidden rounded-lg border p-4 shadow-sm ${cls.shell}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className={`mt-1 line-clamp-2 text-lg font-bold leading-tight text-foreground ${tone === "red" ? cls.text : ""}`}>{value}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{hint}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cls.icon}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background/80">
        <div className={`h-full rounded-full ${cls.bar}`} style={{ width: `${Math.max(5, Math.min(100, progress ?? 100))}%` }} />
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  meta,
  icon: Icon,
}: {
  title: string;
  meta?: React.ReactNode;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
        <h3 className="truncate text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      {meta}
    </div>
  );
}

function scoreTone(score: number) {
  if (score >= 75) return { label: "Высокое соответствие", color: "bg-green-500", text: "text-green-700", border: "border-green-200", bg: "bg-green-50" };
  if (score > 50) return { label: "Среднее соответствие", color: "bg-amber-500", text: "text-amber-700", border: "border-amber-200", bg: "bg-amber-50" };
  return { label: "Низкое соответствие", color: "bg-red-500", text: "text-red-700", border: "border-red-200", bg: "bg-red-50" };
}

function splitChecks(checks?: string | null) {
  if (!checks) return [];
  return checks.split(/[;•\n]/).map((x) => x.trim()).filter(Boolean);
}

function truncateForAi(text: string, maxChars: number): string {
  const t = specText(text);
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n\n[Текст ТС обрезан до ${maxChars} символов для анализа]`;
}

function buildLotTextWithSpec(tender: TenderItem, spec: string, summary: LotSpecSummary | null): string {
  const parts = [
    "Проанализируй пригодность тендера для компании с учётом карточки лота и технической спецификации.",
    "",
    "Карточка лота:",
    buildLotText(tender),
  ];
  if (summary && Object.keys(summary).length > 0) {
    parts.push("", "Структурированная выжимка ТС:", JSON.stringify(summary, null, 2));
  }
  if (specText(spec)) {
    parts.push("", "Извлечённый текст технической спецификации:", truncateForAi(spec, 12000));
  }
  return parts.join("\n");
}

function savedAnalysisFromTender(tender: TenderItem | null): LotAnalyzeResult | null {
  if (!tender || typeof tender.aiScore !== "number") return null;
  const score = Math.max(0, Math.min(100, Math.round(tender.aiScore)));
  const savedReason = specText(tender.ai_analysis);
  const fit = tender.isSuitable || score > 50 ? "подходит" : score >= 35 ? "требует проверки" : "не подходит";
  const services = tender.requiredServices?.length ? ` Найденные услуги по ТС: ${tender.requiredServices.join("; ")}.` : "";
  return {
    score,
    fit,
    summary: score > 50 ? "Лот прошёл анализ по услугам из ТС." : score >= 35 ? "Лот требует ручной проверки по ТС." : "Лот не подходит по составу услуг из ТС.",
    reason: savedReason || `AI оценил лот на ${score}%.${services}`,
    checks: null,
  };
}

function stringsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => sanitizeApiText(String(x))).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [sanitizeApiText(value)];
  }
  return [];
}

function normalizeSpecService(item: unknown): LotSpecService | null {
  if (typeof item === "string") {
    const name = sanitizeApiText(item);
    return name ? { name } : null;
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const name = sanitizeApiText(String(o.name ?? o.title ?? o.service ?? ""));
  if (!name) return null;
  return {
    name,
    category: sanitizeApiText(String(o.category ?? "")),
    quantity: sanitizeApiText(String(o.quantity ?? "")),
    requirements: stringsFromUnknown(o.requirements).slice(0, 6),
    evidence: sanitizeApiText(String(o.evidence ?? "")),
  };
}

function getSpecServices(summary: LotSpecSummary | null): LotSpecService[] {
  const raw =
    Array.isArray(summary?.services)
      ? summary.services
      : Array.isArray(summary?.required_services)
        ? summary.required_services
        : Array.isArray(summary?.requiredServices)
          ? summary.requiredServices
          : Array.isArray(summary?.service_names)
            ? summary.service_names
            : Array.isArray(summary?.items)
              ? summary.items
              : [];
  const seen = new Set<string>();
  const services: LotSpecService[] = [];
  for (const item of raw) {
    const service = normalizeSpecService(item);
    if (!service) continue;
    const key = service.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    services.push(service);
  }
  return services;
}

function mergeServiceNames(...groups: Array<Array<string | undefined>>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const value of group) {
      const name = sanitizeApiText(String(value || ""));
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      result.push(name);
    }
  }
  return result.slice(0, 16);
}

function serviceSearchText(service: LotSpecService): string {
  return [
    service.name,
    service.category,
    service.quantity,
    service.evidence,
    ...(service.requirements ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function specAutoErrorMessage(message: string): string {
  const text = sanitizeApiText(message);
  if (!text || text.toLowerCase() === "failed to fetch") {
    return "Не удалось автоматически разобрать ТС. Сервер не смог получить документ или ответ AI.";
  }
  if (text.includes("нет PDF/DOCX")) {
    return "В документах лота не найден PDF/DOCX для автоматического разбора ТС.";
  }
  if (text.includes("GROQ_API_KEY") || text.includes("GEMINI_API_KEY")) {
    return "AI-разбор ТС сейчас недоступен: на сервере не настроен ключ AI.";
  }
  return text;
}

function tokenizeSimilarity(text: string): Set<string> {
  const stop = new Set(["для", "или", "при", "что", "как", "the", "and", "with", "услуг", "закупка", "поставка"]);
  const words = sanitizeApiText(text)
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4 && !stop.has(x));
  return new Set(words);
}

function similarScore(tender: TenderItem, lot: HistoricalLot): number {
  const tenderTokens = tokenizeSimilarity(`${tender.title} ${tender.description} ${tender.purchaseType ?? ""} ${tenderCompanyName(tender)}`);
  const lotTokens = tokenizeSimilarity(`${lot.title} ${lot.description} ${lot.purchase_type} ${lot.customer_name} ${lot.organizer_name}`);
  let score = 0;
  for (const token of tenderTokens) {
    if (lotTokens.has(token)) score += 3;
  }
  if (tender.purchaseType && lot.purchase_type && tender.purchaseType.toLowerCase() === lot.purchase_type.toLowerCase()) score += 8;
  const company = tenderCompanyName(tender).toLowerCase();
  if (company && `${lot.customer_name} ${lot.organizer_name}`.toLowerCase().includes(company)) score += 10;
  if (Number.isFinite(tender.cost) && tender.cost > 0 && lot.initial_amount > 0) {
    const ratio = Math.min(tender.cost, lot.initial_amount) / Math.max(tender.cost, lot.initial_amount);
    score += ratio * 5;
  }
  return score;
}

function ragLotIdForTender(tender: TenderItem): string {
  return sanitizeApiText(
    tender.lot_source_id ||
    tender.lot ||
    `${tender.source || "tender"}:${tender.id}`,
  );
}

function LotAnalysisCard({ analysis }: { analysis: LotAnalyzeResult }) {
  const score = Math.max(0, Math.min(100, Math.round(analysis.score)));
  const tone = scoreTone(score);
  const checks = splitChecks(analysis.checks);
  return (
    <div className={`space-y-4 rounded-lg border ${tone.border} ${tone.bg} p-4`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Вердикт AI</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`rounded-full bg-background px-3 py-1 text-sm font-semibold ${tone.text}`}>
              {analysis.fit}
            </span>
            <span className={`text-sm font-medium ${tone.text}`}>{tone.label}</span>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className={`text-3xl font-bold ${tone.text}`}>{score}%</div>
          <div className="text-xs text-muted-foreground">пригодность лота</div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-background/80">
          <div className={`h-full rounded-full ${tone.color} transition-all`} style={{ width: `${score}%` }} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-background/80 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Краткий вывод</div>
          <p className="text-sm leading-relaxed text-foreground">{analysis.summary}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/80 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Обоснование</div>
          <p className="text-sm leading-relaxed text-foreground">{analysis.reason}</p>
        </div>
      </div>

      {checks.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-background/80 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Что проверить</div>
          <ul className="space-y-1.5 text-sm text-foreground">
            {checks.map((check, index) => (
              <li key={`${check}-${index}`} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{check}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TenderDetail() {
  const { tenderId } = Route.useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const id = Number(tenderId);
  const [tender, setTender] = useState<TenderItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [lotAnalysis, setLotAnalysis] = useState<LotAnalyzeResult | null>(null);
  const [lotAnalysisLoading, setLotAnalysisLoading] = useState(false);
  const [lotAnalysisError, setLotAnalysisError] = useState<string | null>(null);

  const [ragUploadError, setRagUploadError] = useState<string | null>(null);
  const [ragUploadOk, setRagUploadOk] = useState<string | null>(null);
  const [ragExtractedOverride, setRagExtractedOverride] = useState<string | null>(null);
  const [ragSpecSummary, setRagSpecSummary] = useState<LotSpecSummary | null>(null);
  const [specAutoAnalyzeLoading, setSpecAutoAnalyzeLoading] = useState(false);
  const [specAutoAnalyzeMessage, setSpecAutoAnalyzeMessage] = useState<string | null>(null);
  const [activeDocumentDownloadKey, setActiveDocumentDownloadKey] = useState<string | null>(null);
  const [documentDownloadError, setDocumentDownloadError] = useState<{ key: string; message: string } | null>(null);

  const [actionLoading, setActionLoading] = useState<"participating" | "rejected" | "assignment_requested" | null>(null);
  const [viewInfo, setViewInfo] = useState<TenderViewInfo | null>(null);
  const [similarLots, setSimilarLots] = useState<HistoricalLot[]>([]);
  const [similarLotsLoading, setSimilarLotsLoading] = useState(false);
  const [similarLotsError, setSimilarLotsError] = useState<string | null>(null);

  const returnPage =
    typeof location.state === "object" &&
    location.state !== null &&
    "tendersPage" in location.state &&
    typeof (location.state as { tendersPage: unknown }).tendersPage === "number"
      ? Math.max(1, Math.floor((location.state as { tendersPage: number }).tendersPage))
      : 1;
  const attemptedLazySpecLots = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!Number.isFinite(id) || id < 1) {
      setLoading(false);
      setError("Некорректный ID");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTender(null);
    setLotAnalysis(null);
    setLotAnalysisError(null);
    setLotAnalysisLoading(false);
    fetchTenderById(id)
      .then((t) => { if (!cancelled) { setTender(t); markTenderViewed(id); setViewInfo(getTenderViewInfo(id)); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    setRagUploadError(null);
    setRagUploadOk(null);
    setActiveDocumentDownloadKey(null);
    setDocumentDownloadError(null);
    setSpecAutoAnalyzeLoading(false);
    setSpecAutoAnalyzeMessage(null);
    const cached = Number.isFinite(id) && id > 0 ? getTenderSpecCache(id) : null;
    setRagExtractedOverride(typeof cached?.extractedText === "string" ? cached.extractedText : null);
    setRagSpecSummary(
      cached?.specSummary && typeof cached.specSummary === "object"
        ? (cached.specSummary as LotSpecSummary)
        : null,
    );
  }, [id]);

  const displayTechnicalSpec =
    specText(ragExtractedOverride ?? undefined) || specText(tender?.technical_specification);

  useEffect(() => {
    if (!tender || ragSpecSummary) return;
    const ragLotId = ragLotIdForTender(tender);
    if (!ragLotId) return;
    const availableSpecText = specText(ragExtractedOverride ?? undefined) || specText(tender.technical_specification);
    const attemptKey = `${ragLotId}:backend-auto`;
    if (attemptedLazySpecLots.current.has(attemptKey)) return;
    attemptedLazySpecLots.current.add(attemptKey);

    let cancelled = false;
    setSpecAutoAnalyzeLoading(true);
    setSpecAutoAnalyzeMessage("Ищу готовый разбор ТС или запускаю извлечение услуг…");
    setRagUploadError(null);
    setRagUploadOk(null);

    const acceptSummary = (summary: LotSpecSummary, extractedText?: string) => {
      if (extractedText) setRagExtractedOverride(extractedText);
      setRagSpecSummary(summary);
      saveTenderSpecCache(tender.id, {
        extractedText: extractedText ?? ragExtractedOverride ?? undefined,
        specSummary: summary,
        uploadStatus: "AI-услуги из ТС получены автоматически при открытии лота",
      });
      setSpecAutoAnalyzeMessage(null);
      setRagUploadOk("AI-выжимка ТС получена автоматически.");
    };

    (async () => {
      try {
        const result = await autoExtractTenderSpecSummary(tender.id, { timeoutMs: 180_000 });
        if (cancelled) return;
        if (result.spec_summary && Object.keys(result.spec_summary).length > 0) {
          acceptSummary(result.spec_summary, result.extractedText || availableSpecText || undefined);
          setRagUploadOk(
            result.source === "cached"
              ? "Готовые услуги из ТС загружены."
              : "AI извлёк услуги из ТС автоматически.",
          );
          return;
        }
        setRagUploadOk("ТС обработана, но AI не выделил отдельные услуги. Проверьте документ вручную.");
      } catch (e: unknown) {
        if (cancelled) return;
        setRagUploadOk(null);
        setRagUploadError(specAutoErrorMessage(e instanceof Error ? e.message : String(e)));
      } finally {
        if (!cancelled) {
          setSpecAutoAnalyzeMessage(null);
          setSpecAutoAnalyzeLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [ragExtractedOverride, ragSpecSummary, tender]);

  useEffect(() => {
    const saved = savedAnalysisFromTender(tender);
    if (saved) {
      setLotAnalysis(saved);
      setLotAnalysisError(null);
      setLotAnalysisLoading(false);
    }
  }, [tender]);

  useEffect(() => {
    if (!tender) return;
    let cancelled = false;
    setSimilarLotsLoading(true);
    setSimilarLotsError(null);
    analyticsApi.getLots({
      status: "completed",
      excluded: "include",
      page: 1,
      limit: 100,
    })
      .then((res) => {
        if (cancelled) return;
        const ranked = (res.items ?? [])
          .filter((lot) => lot.lot_id !== tender.id)
          .map((lot) => ({ lot, score: similarScore(tender, lot) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((x) => x.lot);
        setSimilarLots(ranked);
      })
      .catch((e: unknown) => {
        if (!cancelled) setSimilarLotsError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setSimilarLotsLoading(false);
      });
    return () => { cancelled = true; };
  }, [tender]);

  const handleLotAnalyze = useCallback(async () => {
    if (!tender || lotAnalysisLoading) return;
    const lotText = buildLotTextWithSpec(tender, displayTechnicalSpec, ragSpecSummary);
    setLotAnalysisLoading(true);
    setLotAnalysisError(null);
    try {
      const result = await fetchLotAnalyze(lotText, { cacheKey: `tender-${tender.id}-${displayTechnicalSpec ? "with-spec" : "card-only"}`, timeoutMs: 60_000 });
      setLotAnalysis(result);
    } catch (e: unknown) {
      setLotAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setLotAnalysisLoading(false);
    }
  }, [displayTechnicalSpec, ragSpecSummary, tender, lotAnalysisLoading]);

  useEffect(() => {
    if (!tender || lotAnalysis || lotAnalysisLoading || lotAnalysisError) return;
    const hasDocuments = Boolean(tender.documents?.length);
    const hasSpecContext = Boolean(displayTechnicalSpec || ragSpecSummary);
    if (hasDocuments && !hasSpecContext && !ragUploadError && !ragUploadOk) return;
    void handleLotAnalyze();
  }, [displayTechnicalSpec, handleLotAnalyze, lotAnalysis, lotAnalysisError, lotAnalysisLoading, ragSpecSummary, ragUploadError, ragUploadOk, tender]);

  async function handleDownloadDocument(doc: TenderDocument, options?: { announceAsSpec?: boolean }) {
    if (activeDocumentDownloadKey) return;
    const key = tenderDocumentDownloadKey(doc);
    setActiveDocumentDownloadKey(key);
    setDocumentDownloadError(null);
    if (options?.announceAsSpec) {
      setRagUploadError(null);
      setRagUploadOk(null);
    }
    try {
      const blob = await fetchDocumentBlobViaBackendProxy(doc.downloadLink);
      downloadBlobFile(doc.name || "document", blob);
      if (options?.announceAsSpec) {
        setRagUploadOk(`ТС скачана: ${doc.name || "файл"}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setDocumentDownloadError({ key, message });
      if (options?.announceAsSpec) {
        setRagUploadError(message);
      }
    } finally {
      setActiveDocumentDownloadKey(null);
    }
  }

  async function handleDownloadOriginalSpec() {
    if (!tender || activeDocumentDownloadKey) return;
    const picked = pickTenderDocumentForRag(tender.documents);
    if (!picked) {
      setRagUploadError("В документах тендера не найдена ТС в формате PDF/DOC/DOCX.");
      return;
    }
    await handleDownloadDocument(picked, { announceAsSpec: true });
  }

  async function handleSaveSpecToKnowledgeBase() {
    if (!tender || specAutoAnalyzeLoading) return;
    setSpecAutoAnalyzeLoading(true);
    setSpecAutoAnalyzeMessage("Сохраняю ТС в базу знаний и извлекаю услуги…");
    setRagUploadError(null);
    setRagUploadOk(null);
    try {
      const result = await autoExtractTenderSpecSummary(tender.id, { timeoutMs: 180_000 });
      const summary = result.spec_summary && Object.keys(result.spec_summary).length > 0 ? result.spec_summary : null;
      if (summary) {
        setRagSpecSummary(summary);
        if (result.extractedText) setRagExtractedOverride(result.extractedText);
        saveTenderSpecCache(tender.id, {
          extractedText: result.extractedText || displayTechnicalSpec || undefined,
          specSummary: summary,
          uploadStatus: "ТС сохранена в базу знаний",
        });
        setRagUploadOk("ТС сохранена в базу знаний, услуги извлечены.");
      } else {
        setRagUploadOk("ТС обработана и сохранена, но услуги не выделены автоматически.");
      }
    } catch (err: unknown) {
      setRagUploadError(specAutoErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setSpecAutoAnalyzeMessage(null);
      setSpecAutoAnalyzeLoading(false);
    }
  }

  const handleDecision = async (status: "participating" | "rejected" | "assignment_requested") => {
    if (!tender) return;
    setActionLoading(status);
    try {
      const currentUser = getCurrentUser();
      const currentName = currentUser?.name || currentUser?.email || "";
      const deadline = tender.endDate
        ? new Date(tender.endDate).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const payload = {
        id: tender.id,
        external_id: tender.lot_source_id || "",
        source: tender.source || "tenderplus",
        title: tender.title || "Без названия",
        description: tender.description || "",
        amount: tender.cost || 0,
        status,
        deadline,
        start_date: tender.startDate ? new Date(tender.startDate).toISOString() : new Date().toISOString(),
        end_date: deadline,
        purchase_type: tender.purchaseType || "—",
        organizer_name: tenderCompanyName(tender),
        partner_link: tender.partnerLink || "",
        reviewer: status === "assignment_requested" ? currentName : "",
        assigned_to: status === "participating" ? currentName : "",
        comment: status === "assignment_requested" ? "Специалист запросил возможность взять тендер в работу" : "",
      };

      const res = await apiFetch(`${getLocalApiBase()}/api/v1/lots/participate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Ошибка при сохранении");

      const title = blockText(tender.title).slice(0, 60);
      if (status !== "assignment_requested") {
        markTenderDecision(tender.id, status);
      }
      if (status === "participating") {
        void autoExtractTenderSpecSummary(tender.id, { timeoutMs: 180_000 }).catch(() => {});
        pushNotification("success", "Участвуем", `Тендер «${title}» добавлен в заявки.`, "/bids");
        navigate({ to: "/bids" });
      } else if (status === "assignment_requested") {
        pushNotification("info", "Запрос отправлен", `Запрос по тендеру «${title}» ушёл директору.`, "/cabinet");
        navigate({ to: "/cabinet" });
      } else {
        pushNotification("info", "Не подходит", `Тендер «${title}» отклонён.`);
        navigate({ to: "/tenders", search: { page: returnPage } });
      }
    } catch (err) {
      pushNotification("error", "Ошибка", "Не удалось обновить статус тендера.");
    } finally {
      setActionLoading(null);
    }
  };

  const pickedSpecDocument = tender ? pickTenderDocumentForRag(tender.documents) : null;
  const pickedSpecDocumentKey = pickedSpecDocument ? tenderDocumentDownloadKey(pickedSpecDocument) : null;
  const specDownloadLoading = Boolean(
    pickedSpecDocumentKey && activeDocumentDownloadKey === pickedSpecDocumentKey,
  );
  const anyDocumentDownloadLoading = activeDocumentDownloadKey !== null;
  const statusInfo = tender ? getTenderStatus(tender.endDate) : null;
  const companyName = tender ? tenderCompanyName(tender) : "";
  const sourceLabel = tender ? tenderSourceLabel(tender) : "";
  const summaryServices = getSpecServices(ragSpecSummary);
  const requiredServiceNames = mergeServiceNames(
    tender?.requiredServices ?? [],
    summaryServices.map((service) => service.name),
  );
  const currentUser = getCurrentUser();
  const canRequestAssignment = currentUser?.role === "tender_specialist";
  const daysLeft = statusInfo?.daysLeft ?? null;
  const deadlineProgress =
    daysLeft === null
      ? 35
      : daysLeft < 0
        ? 100
        : Math.max(10, Math.min(100, ((14 - Math.min(daysLeft, 14)) / 14) * 100));
  const decisionLabel =
    viewInfo?.decision === "participating"
      ? "Участвуем"
      : viewInfo?.decision === "rejected"
        ? "Отклонён"
        : "На оценке";

  return (
    <>
      <PageHeader
        title={loading ? "Тендер" : tender ? blockText(tender.title).slice(0, 80) : "Тендер"}
        description={tender ? `ID ${tender.id} · закупка buy_id ${tender.buy_id}` : undefined}
        actions={
          <Link
            to="/tenders"
            search={{ page: returnPage }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" /> К списку
          </Link>
        }
      />

      <div className="p-8">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && !tender && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-card px-6 py-24 text-sm text-muted-foreground">
            Загрузка…
          </div>
        )}

        {tender && (
          <div className="space-y-4">
            <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <div className="border-b border-border bg-muted/20 px-5 py-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {tender.source && (
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceBadgeClass(tender.source)}`}>
                          {sourceLabel}
                        </span>
                      )}
                      <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground">
                        ID {tender.id}
                      </span>
                      {tender.lot && (
                        <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground">
                          Лот {tender.lot}
                        </span>
                      )}
                    </div>
                    <div>
                      <h2 className="text-balance text-xl font-semibold leading-snug text-foreground">
                        {blockText(tender.title)}
                      </h2>
                      <p className="mt-2 line-clamp-2 max-w-5xl text-sm leading-6 text-muted-foreground">
                        {tender.description ? blockText(tender.description) : companyName || "Описание лота не указано"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <a
                      href={tender.partnerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-primary hover:bg-accent"
                    >
                      <ExternalLink className="h-4 w-4" /> Площадка
                    </a>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
                <DetailMetric
                  label="Бюджет"
                  value={`${formatTenderAmount(tender.cost)} ₸`}
                  hint={tender.purchaseType || "Сумма лота"}
                  icon={DollarSign}
                  tone="green"
                />
                <DetailMetric
                  label="Срок подачи"
                  value={tender.endDate ? formatShortDateTime(tender.endDate) : "—"}
                  hint={`Осталось: ${deadlineLabel(daysLeft)}`}
                  icon={Clock}
                  tone={deadlineTone(statusInfo?.color)}
                  progress={deadlineProgress}
                />
                <DetailMetric
                  label="Заказчик"
                  value={companyName || tender.partner || "—"}
                  hint={tender.region || tender.partner || "Компания не указана"}
                  icon={Building2}
                  tone="blue"
                />
                <DetailMetric
                  label="Решение"
                  value={decisionLabel}
                  hint={tender.status || `Источник: ${sourceLabel || "—"}`}
                  icon={Hash}
                  tone={viewInfo?.decision === "rejected" ? "red" : viewInfo?.decision === "participating" ? "teal" : "slate"}
                />
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <section className="overflow-hidden rounded-lg border border-primary/20 bg-primary/5 shadow-sm">
                <SectionHeading
                  title="Техническая спецификация"
                  icon={FileText}
                  meta={
                    pickedSpecDocument ? (
                      <span className="rounded-full border border-primary/20 bg-background px-2.5 py-1 text-xs font-medium text-primary">
                        Документ найден
                      </span>
                    ) : null
                  }
                />
                <div className="space-y-4 p-5">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">ТС и база знаний</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {pickedSpecDocument
                        ? `Найден документ: ${blockText(pickedSpecDocument.name)}`
                        : "ТС в документах не найдена. Проверьте список файлов справа."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadOriginalSpec}
                      disabled={!pickedSpecDocument || anyDocumentDownloadLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                    >
                      {specDownloadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {specDownloadLoading ? "Скачивание…" : "Скачать ТС"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSpecToKnowledgeBase}
                      disabled={specAutoAnalyzeLoading || !tender.documents?.length}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {specAutoAnalyzeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                      Сохранить в базу знаний
                    </button>
                  </div>
                  {(ragUploadOk || ragUploadError || specAutoAnalyzeMessage) && (
                    <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                      {specAutoAnalyzeMessage ? (
                        <span className="text-muted-foreground">{specAutoAnalyzeMessage}</span>
                      ) : ragUploadError ? (
                        <span className="text-amber-800">{ragUploadError}</span>
                      ) : (
                        <span className="text-muted-foreground">{ragUploadOk}</span>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                <SectionHeading title="Решение об участии" icon={ThumbsUp} />
                <div className="space-y-4 p-5">
                  {viewInfo && (
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      <div>Просмотрел: <span className="font-medium text-foreground">{viewInfo.viewer}</span></div>
                      <div>{new Date(viewInfo.viewedAt).toLocaleString("ru-RU")}</div>
                      {viewInfo.decision && (
                        <span className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          viewInfo.decision === "participating"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-600"
                        }`}>
                          {viewInfo.decision === "participating" ? "Участвуем" : "Отклонён"}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="grid gap-2">
                    <button
                      onClick={() => handleDecision("participating")}
                      disabled={actionLoading !== null}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
                    >
                      <ThumbsUp className="h-4 w-4" />
                      {actionLoading === "participating" ? "Сохранение…" : "Подходит"}
                    </button>
                    <button
                      onClick={() => handleDecision("rejected")}
                      disabled={actionLoading !== null}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-5 text-sm font-semibold text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
                    >
                      <ThumbsDown className="h-4 w-4" />
                      {actionLoading === "rejected" ? "Сохранение…" : "Не подходит"}
                    </button>
                    {canRequestAssignment && (
                      <button
                        onClick={() => handleDecision("assignment_requested")}
                        disabled={actionLoading !== null}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        {actionLoading === "assignment_requested" ? "Отправка…" : "Запросить взять в работу"}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <TenderWorkspacePanel lotId={tender.id} />

            {/* Основной блок: Описание + Детали */}
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Описание */}
              <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm lg:col-span-2">
                <SectionHeading title="Описание" icon={FileText} />
                <dl className="divide-y divide-border px-6">
                  <InfoRow label="Лот" value={<span className="font-mono text-xs">{tender.lot}</span>} icon={Hash} />
                  <InfoRow label="Наименование" value={blockText(tender.title)} icon={FileText} />
                  <InfoRow
                    label="Сумма"
                    value={<span className="font-semibold text-base">{formatTenderAmount(tender.cost)} ₸</span>}
                    icon={DollarSign}
                  />
                  {tender.region && (
                    <InfoRow label="Регион" value={tender.region} icon={MapPin} />
                  )}
                  {tender.partner && (
                    <InfoRow label="Площадка" value={tender.partner} icon={Building2} />
                  )}
                  {companyName && (
                    <InfoRow label="Заказчик / компания" value={companyName} icon={Building2} />
                  )}
                  {tender.status && (
                    <InfoRow label="Статус" value={tender.status} icon={Hash} />
                  )}
                  {tender.place && (
                    <InfoRow label="Место" value={blockText(tender.place)} icon={MapPin} />
                  )}
                  {tender.description && (
                    <div className="py-3">
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Описание</dt>
                      <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {blockText(tender.description)}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Детали тендера */}
              <div className="space-y-4">
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                  <SectionHeading title="Детали тендера" icon={Calendar} />
                  <dl className="divide-y divide-border px-6">
                    {tender.endDate && (
                      <div className="py-3">
                        <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" /> Завершение приёма заявок
                        </dt>
                        <dd className={`mt-1 text-sm font-semibold ${statusInfo?.color === "red" ? "text-red-600" : "text-foreground"}`}>
                          {formatDate(tender.endDate)}
                          {statusInfo && statusInfo.daysLeft !== null && statusInfo.daysLeft >= 0 && (
                            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                              statusInfo.color === "red" ? "bg-red-100 text-red-600" :
                              statusInfo.color === "orange" ? "bg-orange-100 text-orange-600" :
                              "bg-green-100 text-green-700"
                            }`}>
                              {statusInfo.daysLeft === 0 ? "сегодня" : `${statusInfo.daysLeft} дн.`}
                            </span>
                          )}
                        </dd>
                      </div>
                    )}
                    {tender.startDate && (
                      <div className="py-3">
                        <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" /> Начало подачи
                        </dt>
                        <dd className="mt-1 text-sm text-foreground">{formatDate(tender.startDate)}</dd>
                      </div>
                    )}
                    <div className="py-3">
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Место</dt>
                      <dd className="mt-1 text-sm text-foreground">{blockText(tender.place)}</dd>
                    </div>
                    <div className="py-3">
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Источник лота</dt>
                      <dd className="mt-1 space-y-1">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceBadgeClass(tender.source)}`}>
                          {sourceLabel}
                        </span>
                        <div className="font-mono text-xs text-foreground">{tender.lot_source_id ?? "—"}</div>
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Документы */}
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                  <SectionHeading title="Документы" icon={Download} />
                  <div className="px-4 py-3">
                    {tender.documents && tender.documents.length > 0 ? (
                      <ul className="space-y-2">
                        {tender.documents.map((doc, i) => {
                          const downloadKey = tenderDocumentDownloadKey(doc);
                          const isDownloading = activeDocumentDownloadKey === downloadKey;
                          const downloadError = documentDownloadError?.key === downloadKey ? documentDownloadError.message : null;
                          return (
                            <li key={`${doc.downloadLink}-${i}`} className="space-y-1.5">
                              <button
                                type="button"
                                onClick={() => void handleDownloadDocument(doc)}
                                disabled={anyDocumentDownloadLoading}
                                aria-busy={isDownloading}
                                className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm transition hover:border-primary/30 hover:bg-muted/40 disabled:cursor-wait disabled:opacity-70"
                              >
                                <FileText className="h-4 w-4 shrink-0 text-primary" />
                                <span className="min-w-0 flex-1 truncate font-medium text-primary">
                                  {blockText(doc.name)}
                                </span>
                                <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground sm:inline-flex">
                                  {isDownloading ? "Скачивание" : "Скачать"}
                                </span>
                                {isDownloading ? (
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                                ) : (
                                  <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                )}
                              </button>
                              {downloadError && (
                                <p className="px-1 text-xs leading-5 text-amber-700" role="alert">
                                  {downloadError}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="space-y-1 py-2">
                        <p className="text-sm text-muted-foreground">Файлов нет.</p>
                        {tender.documentsDebug && (
                          <p className="text-xs text-amber-700">{tender.documentsDebug}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Похожие прошлые заказы */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <SectionHeading title="Похожие выполненные заказы" icon={History} />
              <div className="px-6 py-4">
                {similarLotsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
                    Ищу похожие заказы…
                  </div>
                ) : similarLotsError ? (
                  <p className="text-sm text-destructive">{similarLotsError}</p>
                ) : similarLots.length > 0 ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {similarLots.map((lot) => (
                      <div key={lot.id} className="rounded-lg border border-border bg-muted/20 p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-700">
                            выполнен
                          </span>
                          {lot.purchase_type && (
                            <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                              {lot.purchase_type}
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-2 text-sm font-semibold text-foreground">{blockText(lot.title)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {lot.customer_name || lot.organizer_name || "Заказчик не указан"}
                        </p>
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                          <div>
                            <span className="block uppercase tracking-wider">Бюджет</span>
                            <span className="font-medium text-foreground">{fmtM(lot.initial_amount)} ₸</span>
                          </div>
                          <div>
                            <span className="block uppercase tracking-wider">Дата</span>
                            <span className="font-medium text-foreground">{fmtDate(lot.end_date)}</span>
                          </div>
                          {lot.winner_name && (
                            <div className="sm:col-span-2">
                              <span className="block uppercase tracking-wider">Победитель</span>
                              <span className="font-medium text-foreground">{lot.winner_name}</span>
                            </div>
                          )}
                        </div>
                        {lot.partner_link && (
                          <a
                            href={lot.partner_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            Открыть прошлый лот <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Похожих выполненных заказов пока не найдено.
                  </p>
                )}
              </div>
            </div>

            {/* Услуги по ТС */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <div className="border-b border-border bg-muted/20 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Услуги по ТС</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Требования и услуги из технической спецификации.
                      </p>
                    </div>
                  </div>
                  {requiredServiceNames.length > 0 && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      {requiredServiceNames.length} услуг
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-4 px-6 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadOriginalSpec}
                    disabled={!pickedSpecDocument || anyDocumentDownloadLoading}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    {specDownloadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {specDownloadLoading ? "Скачивание…" : "Скачать ТС"}
                  </button>
                  {displayTechnicalSpec && (
                    <button
                      type="button"
                      onClick={() => downloadTextFile(`tender-${tender.id}-spec-text.txt`, displayTechnicalSpec)}
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                    >
                      <Download className="h-4 w-4" /> Скачать извлечённый текст
                    </button>
                  )}
                </div>
                {pickedSpecDocument && (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                    <FileText className="h-4 w-4 text-primary" />
                    <span>Документ:</span>
                    <span className="font-medium text-foreground">{blockText(pickedSpecDocument.name)}</span>
                  </div>
                )}
                {ragUploadError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {ragUploadError}
                  </div>
                )}
                {ragUploadOk && <p className="text-sm text-muted-foreground">{ragUploadOk}</p>}
                {specAutoAnalyzeLoading && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">AI разбирает ТС и извлекает услуги</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {specAutoAnalyzeMessage || "Анализирую документ лота…"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {requiredServiceNames.length > 0 || summaryServices.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {requiredServiceNames.map((name) => {
                      const service = summaryServices.find((item) => item.name.toLowerCase() === name.toLowerCase());
                      return (
                        <span
                          key={name}
                          title={serviceSearchText(service || { name }) || name}
                          className="inline-flex max-w-full items-center rounded-md border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-medium leading-5 text-primary"
                        >
                          <span className="truncate">{name}</span>
                        </span>
                      );
                    })}
                  </div>
                ) : specAutoAnalyzeLoading ? null : (
                  <p className="text-sm text-muted-foreground">
                    Услуги по ТС пока не выделены.
                  </p>
                )}
              </div>
            </div>

            {/* AI Анализ */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <SectionHeading title="AI Анализ" icon={Sparkles} />
              <div className="px-6 py-4">
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={handleLotAnalyze}
                    disabled={lotAnalysisLoading || Boolean(lotAnalysis)}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    {lotAnalysisLoading ? "Анализирую…" : lotAnalysis ? "Анализ выполнен" : "Запустить AI-анализ"}
                  </button>
                </div>
                {lotAnalysisLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
                    Анализирую…
                  </div>
                ) : lotAnalysis ? (
                  <LotAnalysisCard analysis={lotAnalysis} />
                ) : lotAnalysisError ? (
                  <div className="space-y-3">
                    <p className="text-sm text-destructive">{lotAnalysisError}</p>
                    {specText(tender.ai_analysis) && (
                      <div className="max-h-[min(24rem,50vh)] overflow-y-auto rounded-lg border border-border bg-muted/30 px-4 py-3">
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                          {specText(tender.ai_analysis)}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : specText(tender.ai_analysis) ? (
                  <div className="max-h-[min(32rem,70vh)] overflow-y-auto rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                      {specText(tender.ai_analysis)}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Ответ анализа пуст или AI-сервис недоступен.</p>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
      {tender && (
        <TenderAssistantChat
          tenderId={tender.id}
          tenderTitle={blockText(tender.title)}
          documents={tender.documents ?? []}
          requiredServices={tender.requiredServices ?? []}
        />
      )}
    </>
  );
}

function TenderWorkspacePanel({ lotId }: { lotId: number }) {
  const [tasks, setTasks] = useState<TenderTask[]>([]);
  const [comments, setComments] = useState<TenderComment[]>([]);
  const [activity, setActivity] = useState<TenderActivity[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"task" | "comment" | "task-toggle" | null>(null);
  const currentUser = getCurrentUser();
  const currentName = currentUser?.name || currentUser?.email || "Пользователь";

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextTasks, nextComments, nextActivity] = await Promise.all([
        fetchTenderTasks(lotId).catch(() => []),
        fetchTenderComments(lotId).catch(() => []),
        fetchTenderActivity(lotId).catch(() => []),
      ]);
      setTasks(nextTasks);
      setComments(nextComments);
      setActivity(nextActivity);
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addTask = async () => {
    const title = taskTitle.trim();
    if (!title) return;
    setSaving("task");
    try {
      const created = await createTenderTask(lotId, {
        title,
        assignee: currentName,
        priority: "normal",
      });
      setTasks((items) => [created, ...items]);
      setTaskTitle("");
      const nextActivity = await fetchTenderActivity(lotId).catch(() => activity);
      setActivity(nextActivity);
    } catch (err) {
      pushNotification("error", "Задача не сохранена", err instanceof Error ? err.message : "Ошибка сохранения задачи");
    } finally {
      setSaving(null);
    }
  };

  const addComment = async () => {
    const body = commentText.trim();
    if (!body) return;
    setSaving("comment");
    try {
      const created = await createTenderComment(lotId, { author: currentName, body });
      setComments((items) => [created, ...items]);
      setCommentText("");
      const nextActivity = await fetchTenderActivity(lotId).catch(() => activity);
      setActivity(nextActivity);
    } catch (err) {
      pushNotification("error", "Комментарий не сохранен", err instanceof Error ? err.message : "Ошибка сохранения комментария");
    } finally {
      setSaving(null);
    }
  };

  const toggleTask = async (task: TenderTask) => {
    setSaving("task-toggle");
    try {
      const nextStatus = task.status === "done" ? "open" : "done";
      const updated = await updateTenderTask(lotId, task.id, { status: nextStatus });
      setTasks((items) => items.map((item) => item.id === task.id ? updated : item));
      const nextActivity = await fetchTenderActivity(lotId).catch(() => activity);
      setActivity(nextActivity);
    } catch (err) {
      pushNotification("error", "Задача не обновлена", err instanceof Error ? err.message : "Ошибка обновления задачи");
    } finally {
      setSaving(null);
    }
  };

  const openTasks = tasks.filter((task) => task.status !== "done").length;
  const doneTasks = Math.max(0, tasks.length - openTasks);
  const activityPreview = activity.slice(0, 8);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-gradient-to-r from-primary/5 via-background to-background px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ListTodo className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-foreground">Рабочий блок</h3>
              <p className="mt-1 text-sm text-muted-foreground">Задачи, заметки команды и история по этому лоту</p>
            </div>
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-background text-center text-xs">
            <div className="min-w-20 px-3 py-2">
              <div className="font-semibold text-foreground">{openTasks}</div>
              <div className="text-muted-foreground">открыто</div>
            </div>
            <div className="min-w-20 border-x border-border px-3 py-2">
              <div className="font-semibold text-foreground">{doneTasks}</div>
              <div className="text-muted-foreground">готово</div>
            </div>
            <div className="min-w-20 px-3 py-2">
              <div className="font-semibold text-foreground">{comments.length}</div>
              <div className="text-muted-foreground">заметки</div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-sm text-muted-foreground">Загружаю рабочий контекст...</div>
      ) : (
        <div className="space-y-4 p-5">
          <div className="grid overflow-hidden rounded-lg border border-border bg-background xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
            <section className="min-w-0 border-b border-border xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Чеклист подготовки</h4>
                </div>
                <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{openTasks} в работе</span>
              </div>
              <div className="border-b border-border bg-muted/20 p-4">
                <div className="flex gap-2">
                  <input
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void addTask();
                    }}
                    placeholder="Например: проверить сертификаты и сроки поставки"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary"
                  />
                  <button
                    onClick={addTask}
                    disabled={saving === "task" || !taskTitle.trim()}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Добавить
                  </button>
                </div>
              </div>
              <div className="max-h-[24rem] overflow-y-auto">
                {tasks.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Задач пока нет
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {tasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => void toggleTask(task)}
                        disabled={saving === "task-toggle"}
                        className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-muted/40 disabled:opacity-60"
                      >
                        {task.status === "done"
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                          : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm font-medium ${task.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}>
                            {task.title}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                            {task.assignee && <span>Ответственный: {task.assignee}</span>}
                            {task.due_date && <span>Срок: {formatShortDate(task.due_date)}</span>}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="min-w-0">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Комментарии</h4>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{comments.length}</span>
              </div>
              <div className="border-b border-border bg-muted/20 p-4">
                <textarea
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder="Оставьте заметку для команды..."
                  className="min-h-[86px] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={addComment}
                    disabled={saving === "comment" || !commentText.trim()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    Отправить
                  </button>
                </div>
              </div>
              <div className="max-h-[24rem] overflow-y-auto">
                {comments.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Комментариев пока нет
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {comments.map((comment) => (
                      <article key={comment.id} className="px-5 py-4">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-semibold text-foreground">{comment.author || "Пользователь"}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{formatShortDateTime(comment.created_at)}</span>
                        </div>
                        <p className="text-sm leading-5 text-muted-foreground">{comment.body}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">История действий</h4>
              </div>
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{activity.length} событий</span>
            </div>
            {activityPreview.length === 0 ? (
              <div className="px-5 py-8 text-sm text-muted-foreground">
                История появится после первого действия
              </div>
            ) : (
              <div className="divide-y divide-border">
                {activityPreview.map((item) => (
                  <div key={item.id} className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {activityLabel(item.action, item.status)}
                        </span>
                        {item.actor && <span className="text-[11px] text-muted-foreground">Автор: {item.actor}</span>}
                      </div>
                      {item.message && <p className="mt-1 line-clamp-2 text-sm text-foreground">{item.message}</p>}
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {formatShortDateTime(item.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function formatShortDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function activityLabel(action: string, status?: string): string {
  switch (action) {
    case "status_changed":
      return status ? `Статус: ${savedLotStatusLabels[status] || status}` : "Статус изменен";
    case "comment_added":
      return "Комментарий";
    case "task_created":
      return "Задача создана";
    case "task_updated":
      return "Задача обновлена";
    default:
      return action || "Действие";
  }
}
