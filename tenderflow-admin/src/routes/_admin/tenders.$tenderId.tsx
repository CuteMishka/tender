import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { ArrowLeft, ExternalLink, FileText, Sparkles, Upload } from "lucide-react";
import {
  buildLotText,
  fetchDocumentBlobViaBackendProxy,
  fetchLotAnalyze,
  fetchLotSpecSummary,
  fetchTenderById,
  formatTenderAmount,
  getFetchDocumentProxyUrl,
  indexLotDocument,
  pickTenderDocumentForRag,
  sanitizeApiText,
  sanitizeApiTextMultiline,
  tenderDocumentBlobToFile,
  type LotSpecSummary,
  type TenderItem,
} from "@/lib/tenders-api";

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

function TenderDetail() {
  const { tenderId } = Route.useParams();
  const location = useLocation();
  const id = Number(tenderId);
  const [tender, setTender] = useState<TenderItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [lotAnalysis, setLotAnalysis] = useState<string | null>(null);
  const [lotAnalysisLoading, setLotAnalysisLoading] = useState(false);
  const [lotAnalysisError, setLotAnalysisError] = useState<string | null>(null);

  const [ragFile, setRagFile] = useState<File | null>(null);
  const [ragExtractSpecPoints, setRagExtractSpecPoints] = useState(false);
  const [ragIncludeExtractedText, setRagIncludeExtractedText] = useState(true);
  const [ragUploadLoading, setRagUploadLoading] = useState(false);
  const [ragUploadError, setRagUploadError] = useState<string | null>(null);
  const [ragUploadOk, setRagUploadOk] = useState<string | null>(null);
  const [ragExtractedOverride, setRagExtractedOverride] = useState<string | null>(null);
  const [ragSpecSummary, setRagSpecSummary] = useState<LotSpecSummary | null>(null);

  /** Без прокси на бэкенде повторный авто-POST в Strict Mode. */
  const ragAutoViaProxyKeyRef = useRef<string | null>(null);

  const fetchDocumentProxyUrl = getFetchDocumentProxyUrl();

  const returnPage =
    typeof location.state === "object" &&
    location.state !== null &&
    "tendersPage" in location.state &&
    typeof (location.state as { tendersPage: unknown }).tendersPage === "number"
      ? Math.max(1, Math.floor((location.state as { tendersPage: number }).tendersPage))
      : 1;

  const ragLotId = tender ? String(tender.id) : "";

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
      .then((t) => {
        if (!cancelled) setTender(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    ragAutoViaProxyKeyRef.current = null;
    setRagFile(null);
    setRagExtractSpecPoints(false);
    setRagIncludeExtractedText(true);
    setRagUploadError(null);
    setRagUploadOk(null);
    setRagExtractedOverride(null);
    setRagSpecSummary(null);
  }, [id]);

  const submitSpecToRag = useCallback(
    async (
      file: File,
      opts: {
        extractSpecPoints: boolean;
        includeExtractedText: boolean;
        sourceHintSuffix?: string;
      },
    ) => {
      if (!tender) throw new Error("Нет данных тендера");
      setRagUploadLoading(true);
      setRagUploadError(null);
      setRagUploadOk(null);
      try {
        const result = await indexLotDocument(String(tender.id), file, {
          sourceHint: opts.sourceHintSuffix
            ? `tender-${tender.id};${opts.sourceHintSuffix}`
            : `tender-${tender.id}`,
          extractSpecPoints: opts.extractSpecPoints,
          includeExtractedText: opts.includeExtractedText,
        });
        if (result.extracted_text !== undefined && opts.includeExtractedText) {
          setRagExtractedOverride(result.extracted_text);
        }
        if (result.spec_summary && Object.keys(result.spec_summary).length > 0) {
          setRagSpecSummary(result.spec_summary);
        } else if (opts.extractSpecPoints) {
          const saved = await fetchLotSpecSummary(String(tender.id)).catch(() => null);
          if (saved && Object.keys(saved).length > 0) setRagSpecSummary(saved);
        }
        const parts: string[] = [];
        if (result.indexed) parts.push("документ проиндексирован");
        if (typeof result.text_chars === "number") parts.push(`${result.text_chars} символов текста`);
        setRagUploadOk(parts.length ? parts.join(" · ") : "Готово.");
      } finally {
        setRagUploadLoading(false);
      }
    },
    [tender],
  );

  useEffect(() => {
    if (!fetchDocumentProxyUrl || !tender) return;
    const picked = pickTenderDocumentForRag(tender.documents);
    if (!picked) return;

    const key = `${tender.id}\u0000${picked.downloadLink}`;
    if (ragAutoViaProxyKeyRef.current === key) return;
    ragAutoViaProxyKeyRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        const blob = await fetchDocumentBlobViaBackendProxy(picked.downloadLink);
        if (cancelled) return;
        const file = tenderDocumentBlobToFile(picked, blob);
        await submitSpecToRag(file, {
          extractSpecPoints: false,
          includeExtractedText: true,
          sourceHintSuffix: `proxy;${picked.name}`,
        });
      } catch (e: unknown) {
        ragAutoViaProxyKeyRef.current = null;
        if (!cancelled) {
          setRagUploadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tender, fetchDocumentProxyUrl, submitSpecToRag]);

  useEffect(() => {
    if (!tender) return;
    let cancelled = false;
    const lotText = buildLotText(tender);
    setLotAnalysisLoading(true);
    setLotAnalysisError(null);
    setLotAnalysis(null);
    fetchLotAnalyze(lotText)
      .then((text) => {
        if (!cancelled) setLotAnalysis(text);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLotAnalysisError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLotAnalysisLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tender]);

  async function handleRagUpload(e: FormEvent) {
    e.preventDefault();
    if (!tender || !ragFile) return;
    if (!isRagUploadableFile(ragFile)) {
      setRagUploadError("Допустимы только файлы .pdf, .docx или .doc.");
      return;
    }
    try {
      await submitSpecToRag(ragFile, {
        extractSpecPoints: ragExtractSpecPoints,
        includeExtractedText: ragIncludeExtractedText,
      });
    } catch (err: unknown) {
      setRagUploadError(err instanceof Error ? err.message : String(err));
    }
  }

  const displayTechnicalSpec =
    specText(ragExtractedOverride ?? undefined) || specText(tender?.technical_specification);

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
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading && !tender ? (
          <div className="flex items-center justify-center rounded-xl border border-border bg-card px-6 py-24 text-sm text-muted-foreground">
            Загрузка…
          </div>
        ) : null}

        {tender ? (
          <div
            className="overflow-hidden rounded-xl border border-border bg-card"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            <div className="border-b border-border px-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{blockText(tender.title)}</h2>
                  <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {blockText(tender.description)}
                  </p>
                </div>
                <a
                  href={tender.partnerLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-primary hover:bg-accent"
                >
                  <ExternalLink className="h-4 w-4" />
                  Площадка
                </a>
              </div>
            </div>
            <dl className="grid gap-4 px-6 py-6 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Сумма, ₸
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatTenderAmount(tender.cost)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Лот</dt>
                <dd className="mt-1 font-mono text-sm text-foreground">{tender.lot}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Источник лота
                </dt>
                <dd className="mt-1 font-mono text-sm text-foreground">
                  {tender.lot_source_id ?? "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Место</dt>
                <dd className="mt-1 text-sm text-foreground">{blockText(tender.place)}</dd>
              </div>
            </dl>

            <div className="border-t border-border px-6 py-6">
              <h3 className="text-sm font-semibold text-foreground">Документы</h3>
              {tender.documents && tender.documents.length > 0 ? (
                <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-muted/20">
                  {tender.documents.map((doc, i) => (
                    <li key={`${doc.downloadLink}-${i}`}>
                      <a
                        href={doc.downloadLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-muted/60"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 font-medium text-primary underline-offset-2 hover:underline">
                          {blockText(doc.name)}
                        </span>
                        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Прикреплённых файлов нет.</p>
              )}
            </div>

            <div className="border-t border-border px-6 py-6">
              <h3 className="text-sm font-semibold text-foreground">Техническая спецификация</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Файл на RAG:{" "}
                <span className="font-mono text-[11px]">
                  POST …/v1/lots/{ragLotId}/index-document
                </span>
                . С площадки (goszakup) браузер сам файл не тянет —{" "}
                <strong className="font-normal text-foreground">CORS</strong>. Варианты: загрузить ТЗ
                вручную ниже
                {fetchDocumentProxyUrl ? (
                  <>
                    {" "}
                    или через бэкенд{" "}
                    <span className="font-mono text-[11px]">POST …/api/v1/fetch-document</span>
                    {" "}(переменная{" "}
                    <span className="font-mono text-[11px]">VITE_FETCH_DOCUMENT_PROXY_URL</span>) —
                    подходящий документ из списка уходит в RAG автоматически.
                  </>
                ) : (
                  <>
                    {" "}
                    или задать в <span className="font-mono text-[11px]">.env</span> полный URL{" "}
                    <span className="font-mono text-[11px]">POST …/api/v1/fetch-document</span>
                    {" "}на вашем API (<span className="font-mono text-[11px]">VITE_FETCH_DOCUMENT_PROXY_URL</span>
                    ), тело <span className="font-mono text-[11px]">{`{ "url": "…" }`}</span>.
                  </>
                )}
              </p>

              <form onSubmit={handleRagUpload} className="mt-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[200px] flex-1">
                    <label className="sr-only" htmlFor="rag-spec-file">
                      Файл ТЗ
                    </label>
                    <input
                      id="rag-spec-file"
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    {ragUploadLoading ? "Отправка…" : "Отправить в RAG"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={ragExtractSpecPoints}
                      disabled={ragUploadLoading}
                      onChange={(e) => setRagExtractSpecPoints(e.target.checked)}
                    />
                    Выжимка полей через OpenAI (токены)
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={ragIncludeExtractedText}
                      disabled={ragUploadLoading}
                      onChange={(e) => setRagIncludeExtractedText(e.target.checked)}
                    />
                    Включить полный текст в ответе
                  </label>
                </div>
                {ragUploadError ? (
                  <p className="text-sm text-destructive">{ragUploadError}</p>
                ) : null}
                {ragUploadOk ? (
                  <p className="text-sm text-muted-foreground">{ragUploadOk}</p>
                ) : null}
              </form>

              {ragSpecSummary && Object.keys(ragSpecSummary).length > 0 ? (
                <div className="mt-6">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Выжимка ТЗ (RAG)
                  </h4>
                  <div className="mt-2 max-h-[min(20rem,45vh)] overflow-y-auto rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
                      {JSON.stringify(ragSpecSummary, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : null}

              {displayTechnicalSpec ? (
                <div className="mt-6">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Извлечённый текст
                  </h4>
                  <div className="mt-2 max-h-[min(32rem,70vh)] overflow-y-auto rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                      {displayTechnicalSpec}
                    </pre>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Нет текста — загрузите файл выше или дождитесь данных с основного API тендера.
                </p>
              )}
            </div>

            <div className="border-t border-border px-6 py-6">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                ИИ анализ
              </h3>
              <p className="mt-2 text-xs text-muted-foreground">
                Запрос: <span className="font-mono text-[11px] text-foreground/80">{buildLotText(tender)}</span>
              </p>
              {lotAnalysisLoading ? (
                <p className="mt-3 text-sm text-muted-foreground">Запрос анализа…</p>
              ) : specText(lotAnalysis ?? undefined) ? (
                <div className="mt-3 max-h-[min(32rem,70vh)] overflow-y-auto rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                    {specText(lotAnalysis ?? undefined)}
                  </pre>
                </div>
              ) : lotAnalysisError ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-destructive">{lotAnalysisError}</p>
                  {specText(tender.ai_analysis) ? (
                    <>
                      <p className="text-xs text-muted-foreground">Дополнительно из API тендера:</p>
                      <div className="max-h-[min(24rem,50vh)] overflow-y-auto rounded-lg border border-border bg-muted/30 px-4 py-3">
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                          {specText(tender.ai_analysis)}
                        </pre>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : specText(tender.ai_analysis) ? (
                <div className="mt-3 max-h-[min(32rem,70vh)] overflow-y-auto rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                    {specText(tender.ai_analysis)}
                  </pre>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Ответ анализа пуст или недоступен.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
