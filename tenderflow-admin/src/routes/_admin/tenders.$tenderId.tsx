import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import {
  ArrowLeft, ExternalLink, FileText, Sparkles, Upload,
  ThumbsUp, ThumbsDown, Calendar, Building2, MapPin,
  Hash, DollarSign, Clock, Download, History,
} from "lucide-react";
import { analyticsApi, fmtDate, fmtM, type HistoricalLot } from "@/lib/analytics-api";
import {
  buildLotText,
  fetchDocumentBlobViaBackendProxy,
  fetchLotAnalyze,
  fetchLotSpecSummary,
  fetchTenderById,
  formatDate,
  formatTenderAmount,
  getFetchDocumentProxyUrl,
  getLocalApiBase,
  getTenderSpecCache,
  getTenderStatus,
  indexLotDocument,
  markTenderViewed,
  markTenderDecision,
  getTenderViewInfo,
  pickTenderDocumentForRag,
  saveTenderSpecCache,
  sanitizeApiText,
  sanitizeApiTextMultiline,
  tenderCompanyName,
  tenderDocumentBlobToFile,
  type LotAnalyzeResult,
  type LotSpecSummary,
  type TenderItem,
  type TenderViewInfo,
} from "@/lib/tenders-api";
import { pushNotification } from "@/hooks/use-notifications";

export const Route = createFileRoute("/_admin/tenders/$tenderId")({
  ssr: false,
  component: TenderDetail,
});

function blockText(s: string) {
  return sanitizeApiText(s) || "—";
}

function specText(s: string | undefined) {
  if (!s) return "";
  return sanitizeApiTextMultiline(s);
}

function isRagUploadableFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return n.endsWith(".pdf") || n.endsWith(".docx") || n.endsWith(".doc");
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

function scoreTone(score: number) {
  if (score >= 75) return { label: "Высокое соответствие", color: "bg-green-500", text: "text-green-700", border: "border-green-200", bg: "bg-green-50" };
  if (score >= 45) return { label: "Среднее соответствие", color: "bg-amber-500", text: "text-amber-700", border: "border-amber-200", bg: "bg-amber-50" };
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

function LotAnalysisCard({ analysis }: { analysis: LotAnalyzeResult }) {
  const score = Math.max(0, Math.min(100, Math.round(analysis.score)));
  const tone = scoreTone(score);
  const checks = splitChecks(analysis.checks);
  return (
    <div className={`space-y-4 rounded-xl border ${tone.border} ${tone.bg} p-4`}>
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

  const [ragFile, setRagFile] = useState<File | null>(null);
  const [ragExtractSpecPoints, setRagExtractSpecPoints] = useState(false);
  const [ragIncludeExtractedText, setRagIncludeExtractedText] = useState(true);
  const [ragPanelOpen, setRagPanelOpen] = useState(false);
  const [ragUploadLoading, setRagUploadLoading] = useState(false);
  const [ragUploadError, setRagUploadError] = useState<string | null>(null);
  const [ragUploadOk, setRagUploadOk] = useState<string | null>(null);
  const [ragExtractedOverride, setRagExtractedOverride] = useState<string | null>(null);
  const [ragSpecSummary, setRagSpecSummary] = useState<LotSpecSummary | null>(null);
  const [specDownloadLoading, setSpecDownloadLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState<"participating" | "rejected" | null>(null);
  const [viewInfo, setViewInfo] = useState<TenderViewInfo | null>(null);
  const [similarLots, setSimilarLots] = useState<HistoricalLot[]>([]);
  const [similarLotsLoading, setSimilarLotsLoading] = useState(false);
  const [similarLotsError, setSimilarLotsError] = useState<string | null>(null);

  const ragAutoViaProxyKeyRef = useRef<string | null>(null);
  const fetchDocumentProxyUrl = getFetchDocumentProxyUrl();

  const returnPage =
    typeof location.state === "object" &&
    location.state !== null &&
    "tendersPage" in location.state &&
    typeof (location.state as { tendersPage: unknown }).tendersPage === "number"
      ? Math.max(1, Math.floor((location.state as { tendersPage: number }).tendersPage))
      : 1;

  useEffect(() => {
    if (!Number.isFinite(id) || id < 1) {
      setLoading(false);
      setError("Некорректный ID");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTenderById(id)
      .then((t) => { if (!cancelled) { setTender(t); markTenderViewed(id); setViewInfo(getTenderViewInfo(id)); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    ragAutoViaProxyKeyRef.current = null;
    setRagFile(null);
    setRagExtractSpecPoints(false);
    setRagIncludeExtractedText(true);
    setRagUploadError(null);
    setRagUploadOk(null);
    setSpecDownloadLoading(false);
    const cached = Number.isFinite(id) && id > 0 ? getTenderSpecCache(id) : null;
    setRagExtractedOverride(typeof cached?.extractedText === "string" ? cached.extractedText : null);
    setRagSpecSummary(
      cached?.specSummary && typeof cached.specSummary === "object"
        ? (cached.specSummary as LotSpecSummary)
        : null,
    );
  }, [id]);

  const submitSpecToRag = useCallback(
    async (file: File, opts: { extractSpecPoints: boolean; includeExtractedText: boolean; sourceHintSuffix?: string }) => {
      if (!tender) throw new Error("Нет данных тендера");
      setRagUploadLoading(true);
      setRagUploadError(null);
      setRagUploadOk(null);
      try {
        const result = await indexLotDocument(String(tender.id), file, {
          sourceHint: opts.sourceHintSuffix ? `tender-${tender.id};${opts.sourceHintSuffix}` : `tender-${tender.id}`,
          extractSpecPoints: opts.extractSpecPoints,
          includeExtractedText: opts.includeExtractedText,
        });
        const nextExtracted = result.extracted_text !== undefined && opts.includeExtractedText
          ? result.extracted_text
          : ragExtractedOverride ?? undefined;
        if (result.extracted_text !== undefined && opts.includeExtractedText) {
          setRagExtractedOverride(result.extracted_text);
        }
        let nextSummary: LotSpecSummary | undefined;
        if (result.spec_summary && Object.keys(result.spec_summary).length > 0) {
          setRagSpecSummary(result.spec_summary);
          nextSummary = result.spec_summary;
        } else if (opts.extractSpecPoints) {
          const saved = await fetchLotSpecSummary(String(tender.id)).catch(() => null);
          if (saved && Object.keys(saved).length > 0) {
            setRagSpecSummary(saved);
            nextSummary = saved;
          }
        }
        const parts: string[] = [];
        if (result.indexed) parts.push("документ проиндексирован");
        if (typeof result.text_chars === "number") parts.push(`${result.text_chars} символов текста`);
        const status = parts.length ? parts.join(" · ") : "Готово.";
        setRagUploadOk(status);
        saveTenderSpecCache(tender.id, {
          extractedText: nextExtracted,
          specSummary: nextSummary ?? ragSpecSummary ?? undefined,
          uploadStatus: status,
        });
      } finally {
        setRagUploadLoading(false);
      }
    },
    [ragExtractedOverride, ragSpecSummary, tender],
  );

  useEffect(() => {
    if (!fetchDocumentProxyUrl || !tender) return;
    const picked = pickTenderDocumentForRag(tender.documents);
    if (!picked) return;
    const key = `${tender.id}${picked.downloadLink}`;
    if (ragAutoViaProxyKeyRef.current === key) return;
    ragAutoViaProxyKeyRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        const blob = await fetchDocumentBlobViaBackendProxy(picked.downloadLink);
        if (cancelled) return;
        const file = tenderDocumentBlobToFile(picked, blob);
        await submitSpecToRag(file, { extractSpecPoints: false, includeExtractedText: true, sourceHintSuffix: `proxy;${picked.name}` });
      } catch (e: unknown) {
        ragAutoViaProxyKeyRef.current = null;
        if (!cancelled) setRagUploadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [tender, fetchDocumentProxyUrl, submitSpecToRag]);

  const displayTechnicalSpec =
    specText(ragExtractedOverride ?? undefined) || specText(tender?.technical_specification);

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
      const result = await fetchLotAnalyze(lotText, { cacheKey: `tender-${tender.id}-${displayTechnicalSpec ? "with-spec" : "card-only"}` });
      setLotAnalysis(result);
    } catch (e: unknown) {
      setLotAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setLotAnalysisLoading(false);
    }
  }, [displayTechnicalSpec, ragSpecSummary, tender, lotAnalysisLoading]);

  async function handleRagUpload(e: FormEvent) {
    e.preventDefault();
    if (!tender || !ragFile) return;
    if (!isRagUploadableFile(ragFile)) {
      setRagUploadError("Допустимы только файлы .pdf, .docx или .doc.");
      return;
    }
    try {
      await submitSpecToRag(ragFile, { extractSpecPoints: ragExtractSpecPoints, includeExtractedText: ragIncludeExtractedText });
    } catch (err: unknown) {
      setRagUploadError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDownloadOriginalSpec() {
    if (!tender || specDownloadLoading) return;
    const picked = pickTenderDocumentForRag(tender.documents);
    if (!picked) {
      setRagUploadError("В документах тендера не найдена ТС в формате PDF/DOC/DOCX.");
      return;
    }
    setSpecDownloadLoading(true);
    setRagUploadError(null);
    try {
      const blob = await fetchDocumentBlobViaBackendProxy(picked.downloadLink);
      downloadBlobFile(picked.name || `tender-${tender.id}-technical-specification`, blob);
      setRagUploadOk(`ТС скачана: ${picked.name || "файл"}`);
    } catch (err: unknown) {
      setRagUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpecDownloadLoading(false);
    }
  }

  const handleDecision = async (status: "participating" | "rejected") => {
    if (!tender) return;
    setActionLoading(status);
    try {
      const deadline = tender.endDate
        ? new Date(tender.endDate).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const payload = {
        id: tender.id,
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
      };

      const res = await fetch(`${getLocalApiBase()}/api/v1/lots/participate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Ошибка при сохранении");

      const title = blockText(tender.title).slice(0, 60);
      markTenderDecision(tender.id, status);
      if (status === "participating") {
        pushNotification("success", "Участвуем", `Тендер «${title}» добавлен в заявки.`, "/bids");
        navigate({ to: "/bids" });
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

  const statusInfo = tender ? getTenderStatus(tender.endDate) : null;
  const companyName = tender ? tenderCompanyName(tender) : "";

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
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && !tender && (
          <div className="flex items-center justify-center rounded-xl border border-border bg-card px-6 py-24 text-sm text-muted-foreground">
            Загрузка…
          </div>
        )}

        {tender && (
          <div className="space-y-4">

            {/* Блок решения об участии */}
            <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Решение об участии</p>
                  <p className="text-sm text-muted-foreground">
                    Подходит ли лот профилю компании? Выберите действие.
                  </p>
                </div>
                {viewInfo && (
                  <div className="text-right text-xs text-muted-foreground shrink-0 ml-4">
                    <div>Просмотрел: <span className="font-medium text-foreground">{viewInfo.viewer}</span></div>
                    <div>{new Date(viewInfo.viewedAt).toLocaleString("ru-RU")}</div>
                    {viewInfo.decision && (
                      <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        viewInfo.decision === "participating"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-600"
                      }`}>
                        {viewInfo.decision === "participating" ? "Участвуем" : "Отклонён"}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => handleDecision("participating")}
                  disabled={actionLoading !== null}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
                >
                  <ThumbsUp className="h-4 w-4" />
                  {actionLoading === "participating" ? "Сохранение…" : "Подходит"}
                </button>
                <button
                  onClick={() => handleDecision("rejected")}
                  disabled={actionLoading !== null}
                  className="inline-flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-5 py-2.5 text-sm font-semibold text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
                >
                  <ThumbsDown className="h-4 w-4" />
                  {actionLoading === "rejected" ? "Сохранение…" : "Не подходит"}
                </button>
                <a
                  href={tender.partnerLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-medium text-primary hover:bg-accent"
                >
                  <ExternalLink className="h-4 w-4" /> Открыть на площадке
                </a>
              </div>
            </div>

            {/* Основной блок: Описание + Детали */}
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Описание */}
              <div className="lg:col-span-2 rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
                <div className="border-b border-border px-6 py-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Описание</h3>
                </div>
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
                <div className="rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
                  <div className="border-b border-border px-6 py-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Детали тендера</h3>
                  </div>
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
                      <dd className="mt-1 font-mono text-xs text-foreground">{tender.lot_source_id ?? "—"}</dd>
                    </div>
                  </dl>
                </div>

                {/* Документы */}
                <div className="rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
                  <div className="border-b border-border px-6 py-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Документы</h3>
                  </div>
                  <div className="px-4 py-3">
                    {tender.documents && tender.documents.length > 0 ? (
                      <ul className="space-y-1">
                        {tender.documents.map((doc, i) => (
                          <li key={`${doc.downloadLink}-${i}`}>
                            <a
                              href={doc.downloadLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-muted/60"
                            >
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate font-medium text-primary hover:underline">
                                {blockText(doc.name)}
                              </span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="py-2 text-sm text-muted-foreground">Файлов нет.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* AI Анализ */}
            <div className="rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="border-b border-border px-6 py-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary" /> AI Анализ
                </h3>
              </div>
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    Запрос к AI выполняется только вручную. Повторный одинаковый результат может вернуться из локального кэша без расхода лимита.
                  </p>
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
                  <p className="text-sm text-muted-foreground">Ответ анализа пуст или RAG-сервис недоступен.</p>
                )}
              </div>
            </div>

            {/* Похожие прошлые заказы */}
            <div className="rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="border-b border-border px-6 py-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <History className="h-4 w-4 text-primary" /> Похожие выполненные заказы
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Сравнение с историей завершённых лотов по названию, описанию, заказчику, виду закупки и сумме.
                </p>
              </div>
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
                    Похожих выполненных заказов пока не найдено. Они появятся после заполнения истории в аналитике.
                  </p>
                )}
              </div>
            </div>

            {/* Техническая спецификация / RAG */}
            <div className="rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="border-b border-border px-6 py-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Техническая спецификация</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Загрузите ТЗ для индексации в RAG (PDF, DOCX) или скачайте техническую спецификацию из документов тендера.
                </p>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRagPanelOpen((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    <Upload className="h-4 w-4" />
                    {ragPanelOpen ? "Скрыть загрузку" : "Загрузить ТЗ в RAG"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadOriginalSpec}
                    disabled={!pickedSpecDocument || specDownloadLoading}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    {specDownloadLoading ? "Скачивание…" : "Скачать ТС"}
                  </button>
                  {displayTechnicalSpec && (
                    <button
                      type="button"
                      onClick={() => downloadTextFile(`tender-${tender.id}-technical-specification.txt`, displayTechnicalSpec)}
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                    >
                      <Download className="h-4 w-4" /> Скачать текст
                    </button>
                  )}
                </div>
                {pickedSpecDocument && (
                  <p className="text-xs text-muted-foreground">
                    Найден файл ТС: <span className="font-medium text-foreground">{blockText(pickedSpecDocument.name)}</span>
                  </p>
                )}
                {ragPanelOpen && (
                <form onSubmit={handleRagUpload} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[200px] flex-1">
                      <input
                        id="rag-spec-file"
                        type="file"
                        accept=".pdf,.doc,.docx"
                        className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
                        disabled={ragUploadLoading}
                        onChange={(ev) => {
                          const f = ev.target.files?.[0];
                          setRagFile(f ?? null);
                          setRagUploadError(null);
                          setRagUploadOk(null);
                        }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={ragUploadLoading || !ragFile}
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      <Upload className="h-4 w-4" />
                      {ragUploadLoading ? "Отправка…" : "Отправить в RAG"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground">
                      <input type="checkbox" className="rounded" checked={ragExtractSpecPoints} disabled={ragUploadLoading}
                        onChange={(e) => setRagExtractSpecPoints(e.target.checked)} />
                      Выжимка через OpenAI
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground">
                      <input type="checkbox" className="rounded" checked={ragIncludeExtractedText} disabled={ragUploadLoading}
                        onChange={(e) => setRagIncludeExtractedText(e.target.checked)} />
                      Включить текст в ответе
                    </label>
                  </div>
                  {ragUploadError && <p className="text-sm text-destructive">{ragUploadError}</p>}
                  {ragUploadOk && <p className="text-sm text-muted-foreground">{ragUploadOk}</p>}
                </form>
                )}

                {ragSpecSummary && Object.keys(ragSpecSummary).length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Выжимка ТЗ (RAG)</h4>
                    <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-muted/20 px-4 py-3">
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
                        {JSON.stringify(ragSpecSummary, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {displayTechnicalSpec ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Извлечённый текст</h4>
                    <div className="max-h-[min(32rem,70vh)] overflow-y-auto rounded-lg border border-border bg-muted/20 px-4 py-3">
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                        {displayTechnicalSpec}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Нет текста — загрузите файл выше.</p>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </>
  );
}
