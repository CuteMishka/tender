export type TenderDocument = {
  name: string;
  downloadLink: string;
};

export type TenderItem = {
  id: number;
  lot: string;
  lot_source_id: string | null;
  title: string;
  description: string;
  cost: number;
  partnerLink: string;
  place: string;
  buy_id: number;
  documents?: TenderDocument[];
  /** Текст из файла тендера (техническая спецификация), если отдаёт API. */
  technical_specification?: string;
  /** Текст ИИ-анализа тендера, если отдаёт API. */
  ai_analysis?: string;
};

export type TendersListResponse = {
  items: TenderItem[];
  meta: {
    firstId: number;
    lastId: number;
    limitPage: number;
    pageCount: number;
    totalCount: number;
  };
};

const DEFAULT_API_BASE = "https://tenderai-production-70a1.up.railway.app";

/** Прямой URL API: `VITE_BACK_API` или дефолтный Railway. */
function getTenderApiBase(): string {
  const fromEnv =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_BACK_API) ||
    (typeof process !== "undefined" && process.env?.VITE_BACK_API);
  const base = (typeof fromEnv === "string" && fromEnv.trim()) || DEFAULT_API_BASE;
  return base.replace(/\/$/, "");
}

function normalizeInput(input: { page: number; limit?: number }): { page: number; limit: number } {
  const page = Number.isFinite(input.page) && input.page >= 1 ? Math.floor(input.page) : 1;
  const limit =
    typeof input.limit === "number" &&
    Number.isFinite(input.limit) &&
    input.limit >= 1 &&
    input.limit <= 50
      ? Math.floor(input.limit)
      : 10;
  return { page, limit };
}

function normalizeDocuments(raw: unknown): TenderDocument[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: TenderDocument[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name === "string" && typeof e.downloadLink === "string") {
      out.push({ name: e.name, downloadLink: e.downloadLink });
    }
  }
  return out;
}

function readTechnicalSpecification(o: Record<string, unknown>): string | undefined {
  const keys = [
    "technical_specification",
    "technicalSpecification",
    "specification",
    "tech_specification",
    "techSpecification",
  ] as const;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function readAiAnalysis(o: Record<string, unknown>): string | undefined {
  const keys = [
    "ai_analysis",
    "aiAnalysis",
    "llm_analysis",
    "llmAnalysis",
    "ai_summary",
    "aiSummary",
  ] as const;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function normalizeTenderPayload(body: unknown): TenderItem | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (typeof o.id === "number" && typeof o.title === "string") {
    const documents = normalizeDocuments(o.documents);
    const technical_specification = readTechnicalSpecification(o);
    const ai_analysis = readAiAnalysis(o);
    return {
      ...(o as unknown as TenderItem),
      documents,
      ...(technical_specification !== undefined ? { technical_specification } : {}),
      ...(ai_analysis !== undefined ? { ai_analysis } : {}),
    };
  }
  for (const key of ["item", "data", "tender"] as const) {
    const nested = o[key];
    if (nested && typeof nested === "object") {
      const found = normalizeTenderPayload(nested);
      if (found) return found;
    }
  }
  return null;
}

function getItemsArrayFromListBody(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  for (const key of ["items", "data", "results", "tenders", "list"] as const) {
    const v = o[key];
    if (Array.isArray(v)) return v;
  }
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
    const d = o.data as Record<string, unknown>;
    if (Array.isArray(d.items)) return d.items;
    if (Array.isArray(d.data)) return d.data;
  }
  return [];
}

function defaultListMeta(items: TenderItem[], limit: number): TendersListResponse["meta"] {
  return {
    firstId: items[0]?.id ?? 0,
    lastId: items[items.length - 1]?.id ?? 0,
    limitPage: limit,
    pageCount: 1,
    totalCount: items.length,
  };
}

function metaFromRecord(
  m: Record<string, unknown>,
  items: TenderItem[],
  limit: number,
): TendersListResponse["meta"] {
  return {
    firstId: typeof m.firstId === "number" ? m.firstId : (items[0]?.id ?? 0),
    lastId: typeof m.lastId === "number" ? m.lastId : (items[items.length - 1]?.id ?? 0),
    limitPage: typeof m.limitPage === "number" ? m.limitPage : limit,
    pageCount: typeof m.pageCount === "number" ? Math.max(1, m.pageCount) : 1,
    totalCount: typeof m.totalCount === "number" ? m.totalCount : items.length,
  };
}

function readListMetaFromEnvelope(
  raw: unknown,
  items: TenderItem[],
  limit: number,
): TendersListResponse["meta"] {
  if (!raw || typeof raw !== "object") return defaultListMeta(items, limit);
  const o = raw as Record<string, unknown>;
  let block: unknown =
    o.meta ??
    (o.extensions && typeof o.extensions === "object" && !Array.isArray(o.extensions) ? o.extensions : undefined);
  if (!block && o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
    const d = o.data as Record<string, unknown>;
    block = d.meta ?? (d.extensions && typeof d.extensions === "object" && !Array.isArray(d.extensions) ? d.extensions : undefined);
  }
  if (block && typeof block === "object") {
    return metaFromRecord(block as Record<string, unknown>, items, limit);
  }
  return defaultListMeta(items, limit);
}

/** Приводит ответ списка к `{ items, meta }` — бэкенд может отдавать `data`, вложенный объект и т.д. */
function normalizeTendersListResponse(raw: unknown, limit: number): TendersListResponse {
  const arr = getItemsArrayFromListBody(raw);
  const items: TenderItem[] = [];
  for (const entry of arr) {
    const t = normalizeTenderPayload(entry);
    if (t) items.push(t);
  }
  const meta = readListMetaFromEnvelope(raw, items, limit);
  return { items, meta };
}

/** Загрузка тендеров напрямую с бэкенда (браузер → Railway). Нужен CORS на API. */
export async function fetchTendersList(input: {
  page: number;
  limit?: number;
}): Promise<TendersListResponse> {
  const { page, limit } = normalizeInput(input);
  const base = getTenderApiBase();
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("page", String(page));

  const url = `${base}/api/v1/tenders?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tenders API ${res.status}: ${text.slice(0, 240)}`);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    raw = null;
  }
  return normalizeTendersListResponse(raw, limit);
}

/**
 * Сначала GET `/api/v1/tenders/:id`; если нет тела в ожидаемом виде или 404/405 —
 * ищет в списке по страницам (тот же контракт, что у списка).
 */
export async function fetchTenderById(id: number): Promise<TenderItem> {
  if (!Number.isFinite(id) || id < 1) {
    throw new Error("Некорректный ID тендера");
  }
  const base = getTenderApiBase();
  const detailRes = await fetch(`${base}/api/v1/tenders/${id}`);
  if (detailRes.ok) {
    let body: unknown;
    try {
      body = await detailRes.json();
    } catch {
      body = null;
    }
    const fromDetail = normalizeTenderPayload(body);
    if (fromDetail) return fromDetail;
  } else if (detailRes.status !== 404 && detailRes.status !== 405) {
    const text = await detailRes.text();
    throw new Error(`Tenders API ${detailRes.status}: ${text.slice(0, 240)}`);
  }

  const maxPages = 50;
  for (let page = 1; page <= maxPages; page++) {
    const list = await fetchTendersList({ page, limit: 50 });
    const hit = list.items.find((t) => t.id === id);
    if (hit) return hit;
    if (page >= (list.meta.pageCount || 1)) break;
  }
  throw new Error("Тендер не найден");
}

/** Декодирует типичные HTML-сущности из API и схлопывает переносы (как в твоём JSON). */
export function sanitizeApiText(s: string): string {
  if (!s) return "";
  let t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 10)));
  t = t.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
    String.fromCodePoint(Number.parseInt(h, 16)),
  );
  return t.replace(/\s+/g, " ").trim();
}

/** Как `sanitizeApiText`, но сохраняет переносы строк — для длинного текста из файла. */
export function sanitizeApiTextMultiline(s: string): string {
  if (!s) return "";
  let t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 10)));
  t = t.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
    String.fromCodePoint(Number.parseInt(h, 16)),
  );
  return t.trim();
}

export function formatTenderAmount(cost: number): string {
  if (!Number.isFinite(cost) || cost < 0) return "—";
  if (cost === 0) return "0";
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(cost);
}

/** RAG + анализ лота: локально обычно порт 8083. */
const DEFAULT_LOT_ANALYZE_BASE = "http://127.0.0.1:8083";

/**
 * База `{VITE_RAG_API}` для POST `/v1/lots/{lot_id}/index-document` и остального RAG.
 * Важно: обращение к `import.meta.env.VITE_*` — прямое, иначе Vite может не подставить значение.
 */
function readRagServiceBaseFromEnv(): string | undefined {
  if (typeof import.meta !== "undefined" && import.meta.env) {
    const rag = import.meta.env.VITE_RAG_API;
    if (typeof rag === "string" && rag.trim()) return rag.trim();
    const legacy = import.meta.env.VITE_LOT_ANALYZE_API;
    if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  }
  if (typeof process !== "undefined" && process.env) {
    const rag = process.env.VITE_RAG_API;
    if (typeof rag === "string" && rag.trim()) return rag.trim();
    const legacy = process.env.VITE_LOT_ANALYZE_API;
    if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  }
  return undefined;
}

/** `{VITE_RAG_API}` без завершающего `/` — сюда же уходит файл ТЗ на `.../index-document`. */
export function getRagApiBase(): string {
  const base = readRagServiceBaseFromEnv() || DEFAULT_LOT_ANALYZE_BASE;
  return base.replace(/\/$/, "");
}

/**
 * То же, что `getRagApiBase` (историческое имя для `/v1/lot/analyze`).
 * @deprecated предпочтительно `getRagApiBase`
 */
export function getLotAnalyzeApiBase(): string {
  return getRagApiBase();
}

/**
 * Текст лота для POST `/v1/lot/analyze` — кратко, как в примере:
 * «Услуги хостинга… Астана, сумма 50000 тг.»
 */
export function buildLotText(t: TenderItem): string {
  const main =
    sanitizeApiText(t.description) || sanitizeApiText(t.title) || sanitizeApiText(t.lot);
  const place = sanitizeApiText(t.place);
  const sumPart =
    Number.isFinite(t.cost) && t.cost >= 0
      ? `сумма ${formatTenderAmount(t.cost)} тг`
      : "";
  const suffix = [place || null, sumPart || null].filter(Boolean).join(", ");
  if (!suffix) return main || "—";
  const sep = main.endsWith(".") ? " " : ". ";
  return `${main}${sep}${suffix}.`;
}

function extractLotAnalyzeBody(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const k of ["analysis", "result", "text", "content", "message", "output", "lot_analysis"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const data = o.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["analysis", "result", "text"]) {
      const v = d[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * POST `{ "lot_text": "..." }` на `/v1/lot/analyze`.
 * Ответ: JSON с текстовым полем или обычный текст.
 */
export async function fetchLotAnalyze(lotText: string): Promise<string | null> {
  const trimmed = lotText.trim();
  if (!trimmed) return null;

  const base = getRagApiBase();
  const url = `${base}/v1/lot/analyze`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
    body: JSON.stringify({ lot_text: trimmed }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Анализ лота ${res.status}: ${rawText.slice(0, 240)}`);
  }

  const t = rawText.trim();
  if (!t) return null;

  try {
    const parsed: unknown = JSON.parse(t);
    const extracted = extractLotAnalyzeBody(parsed);
    if (extracted) return extracted;
  } catch {
    /* не JSON — показываем как текст */
  }

  return t;
}

/**
 * Полный URL прокси скачивания вложений с площадки (обход CORS в браузере).
 * Задаётся как `VITE_FETCH_DOCUMENT_PROXY_URL`, например `http://localhost:8082/api/v1/fetch-document`
 * (тот же хост, что `VITE_BACK_API`, путь как на бэкенде).
 *
 * Контракт бэкенда: `POST /api/v1/fetch-document`, тело `{"url":"https://..."}`.
 * Успех `200` — сырые байты файла; ошибки — JSON `{"detail":"..."}` (400 / 502 / 503 / 504).
 */
export function getFetchDocumentProxyUrl(): string | undefined {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_FETCH_DOCUMENT_PROXY_URL) {
    const u = String(import.meta.env.VITE_FETCH_DOCUMENT_PROXY_URL).trim();
    if (u) return u;
  }
  if (typeof process !== "undefined" && process.env?.VITE_FETCH_DOCUMENT_PROXY_URL) {
    const u = String(process.env.VITE_FETCH_DOCUMENT_PROXY_URL).trim();
    if (u) return u;
  }
  return undefined;
}

function readFetchDocumentProxyError(status: number, rawText: string): string {
  try {
    const j = JSON.parse(rawText) as unknown;
    if (j && typeof j === "object" && "detail" in j) {
      const d = (j as { detail: unknown }).detail;
      if (typeof d === "string" && d.trim()) return d.trim();
    }
  } catch {
    /* не JSON */
  }
  const t = rawText.trim();
  return t ? t.slice(0, 400) : `HTTP ${status}`;
}

/** Скачивание по внешнему URL через прокси бэкенда (не напрямую с goszakup — там CORS). */
export async function fetchDocumentBlobViaBackendProxy(remoteUrl: string): Promise<Blob> {
  const proxy = getFetchDocumentProxyUrl();
  if (!proxy) {
    throw new Error(
      "Задайте VITE_FETCH_DOCUMENT_PROXY_URL (POST /api/v1/fetch-document на бэкенде), иначе скачивание с площадки из браузера блокируется CORS.",
    );
  }
  const res = await fetch(proxy, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/octet-stream, application/pdf, application/msword, */*",
    },
    body: JSON.stringify({ url: remoteUrl }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = readFetchDocumentProxyError(res.status, text);
    throw new Error(`Прокси документа (${res.status}): ${detail}`);
  }
  return res.blob();
}

function guessRagDocExtension(name: string, downloadLink: string): "pdf" | "docx" | "doc" | null {
  const tryOne = (s: string) => {
    const m = s.match(/\.(pdf|docx|doc)(?:[\s?#]|$)/i);
    return m ? (m[1].toLowerCase() as "pdf" | "docx" | "doc") : null;
  };
  return tryOne(name) ?? tryOne(downloadLink);
}

/**
 * Выбор вложения для индексации: приоритет имени с ТЗ/спецификацией, иначе первый pdf/docx/doc.
 */
export function pickTenderDocumentForRag(documents: TenderDocument[] | undefined): TenderDocument | null {
  if (!documents?.length) return null;
  const ok = documents.filter((d) => guessRagDocExtension(d.name, d.downloadLink) !== null);
  if (!ok.length) return null;
  const kw = /спецификац|технич|т\.?\s*з\.?|техзадан/i;
  const preferred = ok.find((d) => kw.test(d.name));
  return preferred ?? ok[0];
}

/** Собирает `File` для multipart после прокси-блоба. */
export function tenderDocumentBlobToFile(doc: TenderDocument, blob: Blob): File {
  const ext = guessRagDocExtension(doc.name, doc.downloadLink);
  let fname = doc.name.trim();
  if (!fname) fname = ext ? `document.${ext}` : "document.bin";
  const mime =
    blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : ext === "pdf"
        ? "application/pdf"
        : ext === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : ext === "doc"
            ? "application/msword"
            : "application/octet-stream";
  return new File([blob], fname, { type: mime });
}

/** Ответ POST `/v1/lots/{lot_id}/index-document` (RAG). */
export type IndexLotDocumentResult = {
  indexed: boolean;
  text_chars?: number;
  extracted_text?: string;
  spec_summary?: Record<string, unknown>;
};

/** GET `/v1/lots/{lot_id}/spec-summary` — сохранённая выжимка ТЗ. */
export type LotSpecSummary = Record<string, unknown>;

function parseIndexDocumentJson(body: unknown): IndexLotDocumentResult {
  if (!body || typeof body !== "object") {
    return { indexed: false };
  }
  const o = body as Record<string, unknown>;
  const spec = o.spec_summary;
  return {
    indexed: o.indexed === true,
    text_chars: typeof o.text_chars === "number" ? o.text_chars : undefined,
    extracted_text: typeof o.extracted_text === "string" ? o.extracted_text : undefined,
    spec_summary:
      spec && typeof spec === "object" && !Array.isArray(spec)
        ? (spec as Record<string, unknown>)
        : undefined,
  };
}

function formatRagIndexError(status: number, rawText: string, body: unknown): string {
  const detail =
    body && typeof body === "object" && "detail" in body
      ? String((body as { detail: unknown }).detail)
      : rawText.trim().slice(0, 400);
  if (status === 503) {
    return "Выжимка через OpenAI недоступна: на сервисе RAG не задан OPENAI_API_KEY (503).";
  }
  if (status === 502) {
    return `Ошибка OpenAI при выжимке (502): ${detail || "без деталей"}`;
  }
  if (status === 400) {
    return `Не удалось обработать файл (400): ${detail || "пустой файл, формат или извлечение текста"}`;
  }
  return `Индексация документа ${status}: ${detail || rawText.slice(0, 240)}`;
}

/**
 * Загрузка PDF/DOCX ТЗ на RAG: извлечение текста, индекс лота.
 * `lot_id` — строковый id лота на вашей стороне (как в матчинге / URL).
 */
export async function indexLotDocument(
  lotId: string,
  file: File,
  options?: {
    sourceHint?: string;
    extractSpecPoints?: boolean;
    includeExtractedText?: boolean;
  },
): Promise<IndexLotDocumentResult> {
  const trimmedId = lotId.trim();
  if (!trimmedId) throw new Error("Пустой идентификатор лота");

  const base = getRagApiBase();
  const url = `${base}/v1/lots/${encodeURIComponent(trimmedId)}/index-document`;
  const form = new FormData();
  form.append("file", file);
  if (options?.sourceHint !== undefined && options.sourceHint !== "") {
    form.append("source_hint", options.sourceHint);
  }
  form.append("extract_spec_points", options?.extractSpecPoints === true ? "true" : "false");
  form.append("include_extracted_text", options?.includeExtractedText === false ? "false" : "true");

  const res = await fetch(url, { method: "POST", body: form });
  const rawText = await res.text();
  let body: unknown = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(formatRagIndexError(res.status, rawText, body));
  }

  return parseIndexDocumentJson(body);
}

/** Сохранённая на RAG выжимка ТЗ (после индексации с extract_spec_points). */
export async function fetchLotSpecSummary(lotId: string): Promise<LotSpecSummary | null> {
  const trimmedId = lotId.trim();
  if (!trimmedId) return null;

  const base = getRagApiBase();
  const url = `${base}/v1/lots/${encodeURIComponent(trimmedId)}/spec-summary`;
  const res = await fetch(url);
  const rawText = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Выжимка ТЗ ${res.status}: ${rawText.slice(0, 240)}`);
  }
  try {
    const body = rawText ? JSON.parse(rawText) : null;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as LotSpecSummary;
    }
  } catch {
    /* ignore */
  }
  return null;
}
