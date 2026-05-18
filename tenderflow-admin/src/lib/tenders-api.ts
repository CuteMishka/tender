// ─── Viewed-tenders tracker ───────────────────────────────────────────────────

const VIEWED_KEY = "viewed_tenders";
const VIEWED_INFO_KEY = "viewed_tenders_info";

export type TenderViewInfo = {
  viewer: string;
  viewedAt: string;
  decision?: "participating" | "rejected" | null;
  decisionAt?: string | null;
};

function getCurrentViewer(): string {
  try {
    return localStorage.getItem("tender_viewer_name") || "Администратор";
  } catch {
    return "Администратор";
  }
}

export function setViewerName(name: string): void {
  try { localStorage.setItem("tender_viewer_name", name); } catch { /* ignore */ }
}

function loadViewInfoMap(): Record<string, TenderViewInfo> {
  try {
    const raw = localStorage.getItem(VIEWED_INFO_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, TenderViewInfo>;
  } catch {
    return {};
  }
}

function saveViewInfoMap(map: Record<string, TenderViewInfo>): void {
  try {
    const keys = Object.keys(map);
    if (keys.length > 500) {
      const trimmed: Record<string, TenderViewInfo> = {};
      for (const k of keys.slice(-500)) trimmed[k] = map[k];
      localStorage.setItem(VIEWED_INFO_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(VIEWED_INFO_KEY, JSON.stringify(map));
    }
  } catch { /* ignore */ }
}

export function markTenderViewed(id: number): void {
  try {
    const set = getViewedTenders();
    set.add(id);
    const arr = [...set].slice(-500);
    localStorage.setItem(VIEWED_KEY, JSON.stringify(arr));

    const map = loadViewInfoMap();
    if (!map[String(id)]) {
      map[String(id)] = {
        viewer: getCurrentViewer(),
        viewedAt: new Date().toISOString(),
        decision: null,
        decisionAt: null,
      };
      saveViewInfoMap(map);
    }
  } catch { /* ignore */ }
}

export function markTenderDecision(id: number, decision: "participating" | "rejected"): void {
  try {
    const map = loadViewInfoMap();
    const existing = map[String(id)] || {
      viewer: getCurrentViewer(),
      viewedAt: new Date().toISOString(),
    };
    map[String(id)] = {
      ...existing,
      decision,
      decisionAt: new Date().toISOString(),
    };
    saveViewInfoMap(map);
  } catch { /* ignore */ }
}

export function getTenderViewInfo(id: number): TenderViewInfo | null {
  try {
    const map = loadViewInfoMap();
    return map[String(id)] || null;
  } catch {
    return null;
  }
}

export function getAllViewInfo(): Record<string, TenderViewInfo> {
  return loadViewInfoMap();
}

export function getViewedTenders(): Set<number> {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

// ─── Tender spec localStorage persistence ─────────────────────────────────────

const SPEC_KEY = "tender_spec_cache";

export type TenderSpecCache = {
  extractedText?: string;
  specSummary?: Record<string, unknown>;
  uploadStatus?: string;
  savedAt?: string;
};

export function saveTenderSpecCache(tenderId: number, data: TenderSpecCache): void {
  try {
    const raw = localStorage.getItem(SPEC_KEY);
    const map: Record<string, TenderSpecCache> = raw ? JSON.parse(raw) : {};
    map[String(tenderId)] = { ...data, savedAt: new Date().toISOString() };
    const keys = Object.keys(map);
    if (keys.length > 200) {
      const trimmed: Record<string, TenderSpecCache> = {};
      for (const k of keys.slice(-200)) trimmed[k] = map[k];
      localStorage.setItem(SPEC_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(SPEC_KEY, JSON.stringify(map));
    }
  } catch { /* ignore */ }
}

export function getTenderSpecCache(tenderId: number): TenderSpecCache | null {
  try {
    const raw = localStorage.getItem(SPEC_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, TenderSpecCache>;
    return map[String(tenderId)] || null;
  } catch {
    return null;
  }
}

export function clearTenderSpecCache(tenderId: number): void {
  try {
    const raw = localStorage.getItem(SPEC_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, TenderSpecCache>;
    delete map[String(tenderId)];
    localStorage.setItem(SPEC_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TenderDocument = {
  name: string;
  downloadLink: string;
};

export type LotSpecService = {
  name: string;
  category?: string;
  quantity?: string;
  requirements?: string[];
  evidence?: string;
};

export type LotSpecSummary = Record<string, unknown> & {
  provider?: string;
  overview?: string;
  services?: LotSpecService[];
  key_requirements?: string[];
  deliverables?: string[];
  terms_and_deadlines?: string[];
  constraints?: string[];
  open_questions?: string[];
};

export type TenderItem = {
  id: number;
  lot: string;
  lot_source_id: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  title: string;
  description: string;
  cost: number;
  one_cost?: number | null;
  counts?: number | null;
  partnerLink: string;
  place: string;
  buy_id: number;
  endDate?: string | null;
  startDate?: string | null;
  region?: string | null;
  partner?: string | null;
  organizer_name?: string | null;
  organizerName?: string | null;
  customer_name?: string | null;
  customerName?: string | null;
  status?: string | null;
  purchaseType?: string | null;
  isSuitable?: boolean | null;
  matchedKeyword?: string | null;
  matchScore?: number | null;
  documents?: TenderDocument[];
  technical_specification?: string;
  ai_analysis?: string;
};

/** Вычисляет «виртуальный» статус лота на основе endDate. */
export function getTenderStatus(endDate: string | null | undefined): {
  label: string;
  color: "green" | "red" | "orange" | "gray";
  daysLeft: number | null;
} {
  if (!endDate) return { label: "Неизвестно", color: "gray", daysLeft: null };
  const end = new Date(endDate);
  if (isNaN(end.getTime())) return { label: "Неизвестно", color: "gray", daysLeft: null };
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { label: "Завершён", color: "gray", daysLeft };
  if (daysLeft <= 3) return { label: `${daysLeft} дн.`, color: "red", daysLeft };
  if (daysLeft <= 14) return { label: `${daysLeft} дн.`, color: "orange", daysLeft };
  return { label: `${daysLeft} дн.`, color: "green", daysLeft };
}

export function tenderCompanyName(tender: TenderItem): string {
  return (
    tender.customer_name ||
    tender.customerName ||
    tender.organizer_name ||
    tender.organizerName ||
    tender.partner ||
    ""
  ).trim();
}

export function tenderSourceLabel(tender: TenderItem): string {
  if (tender.sourceLabel?.trim()) return tender.sourceLabel.trim();
  switch ((tender.source || "").trim().toLowerCase()) {
    case "zakup":
      return "Госзакупки";
    case "goszakup":
      return "Госзакупки";
    case "samruk":
      return "Самрук.kz";
    default:
      return "Источник не указан";
  }
}

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

function getTenderApiBase(): string {
  const fromEnv =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_BACK_API) ||
    (typeof process !== "undefined" && process.env?.VITE_BACK_API);
  const base = (typeof fromEnv === "string" && fromEnv.trim()) || DEFAULT_API_BASE;
  return base.replace(/\/$/, "");
}

/** База для локальных эндпоинтов (дашборд, заявки).
 *  Читает VITE_LOCAL_API, иначе падает на VITE_BACK_API, иначе localhost:8082. */
export function getLocalApiBase(): string {
  if (typeof import.meta !== "undefined" && import.meta.env) {
    const local = import.meta.env.VITE_LOCAL_API;
    if (typeof local === "string" && local.trim()) return local.trim().replace(/\/$/, "");
    const back = import.meta.env.VITE_BACK_API;
    if (typeof back === "string" && back.trim()) return back.trim().replace(/\/$/, "");
  }
  return "http://localhost:8082";
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
      purchaseType: typeof o.purchaseType === "string" ? o.purchaseType : null,
      endDate: typeof o.endDate === "string" ? o.endDate : null,
      startDate: typeof o.startDate === "string" ? o.startDate : null,
      region: typeof o.region === "string" ? o.region : null,
      partner: typeof o.partner === "string" ? o.partner : null,
      source: typeof o.source === "string" ? o.source : null,
      sourceLabel: typeof o.sourceLabel === "string" ? o.sourceLabel : null,
      organizer_name: typeof o.organizer_name === "string" ? o.organizer_name : null,
      organizerName: typeof o.organizerName === "string" ? o.organizerName : null,
      customer_name: typeof o.customer_name === "string" ? o.customer_name : null,
      customerName: typeof o.customerName === "string" ? o.customerName : null,
      status: typeof o.status === "string" ? o.status : null,
      isSuitable: typeof o.isSuitable === "boolean" ? o.isSuitable : null,
      matchedKeyword: typeof o.matchedKeyword === "string" ? o.matchedKeyword : null,
      matchScore: typeof o.matchScore === "number" ? o.matchScore : null,
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

export async function fetchTendersList(input: {
  page: number;
  limit?: number;
  keywords?: string;
  suitable?: boolean;
}): Promise<TendersListResponse> {
  const { page, limit } = normalizeInput(input);
  const base = getTenderApiBase();
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("page", String(page));
  if (input.keywords?.trim()) params.set("keywords", input.keywords.trim());
  if (input.suitable) params.set("suitable", "true");

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

export async function fetchTenderById(id: number): Promise<TenderItem> {
  if (!Number.isFinite(id) || id < 1) {
    throw new Error("Некорректный ID тендера");
  }
  const base = getTenderApiBase();

  // Сначала пробуем прямой GET /api/v1/tenders/:id
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

  // Фолбек: ищем по страницам
  const maxPages = 50;
  for (let page = 1; page <= maxPages; page++) {
    const list = await fetchTendersList({ page, limit: 50 });
    const hit = list.items.find((t) => t.id === id);
    if (hit) return hit;
    if (page >= (list.meta.pageCount || 1)) break;
  }
  throw new Error("Тендер не найден");
}

export function sanitizeApiText(s: string): string {
  if (!s) return "";
  let t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 10)));
  t = t.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
    String.fromCodePoint(Number.parseInt(h, 16)),
  );
  return t.replace(/\s+/g, " ").trim();
}

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

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-KZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DEFAULT_LOT_ANALYZE_BASE = "http://127.0.0.1:8083";

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

export function getRagApiBase(): string {
  const base = readRagServiceBaseFromEnv() || DEFAULT_LOT_ANALYZE_BASE;
  return base.replace(/\/$/, "");
}

/** @deprecated предпочтительно getRagApiBase */
export function getLotAnalyzeApiBase(): string {
  return getRagApiBase();
}

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

export type LotAnalyzeResult = {
  summary: string;
  fit: string;
  score: number;
  reason: string;
  checks?: string | null;
  raw?: string;
};

const LOT_ANALYZE_CACHE_PREFIX = "lot_analyze_cache_v1:";
const LOT_ANALYZE_ATTEMPT_PREFIX = "lot_analyze_attempt_v1:";
const LOT_ANALYZE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const lotAnalyzeInFlight = new Map<string, Promise<LotAnalyzeResult | null>>();
const DEFAULT_COMPANY_PROFILE =
  "Компания оказывает услуги по облачной инфраструктуре IaaS, серверному оборудованию, виртуализации, резервному копированию, технической поддержке и внедрению IT-инфраструктуры.";

function readCompanyProfile(): string {
  if (typeof import.meta !== "undefined" && import.meta.env) {
    const profile = import.meta.env.VITE_COMPANY_PROFILE;
    if (typeof profile === "string" && profile.trim()) return profile.trim();
  }
  if (typeof process !== "undefined" && process.env?.VITE_COMPANY_PROFILE) {
    const profile = process.env.VITE_COMPANY_PROFILE;
    if (typeof profile === "string" && profile.trim()) return profile.trim();
  }
  return DEFAULT_COMPANY_PROFILE;
}

function stableHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function normalizeLotAnalyzeResult(raw: unknown): LotAnalyzeResult | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    try {
      return normalizeLotAnalyzeResult(JSON.parse(text));
    } catch {
      return { summary: text, fit: "сомнительно", score: 50, reason: text, checks: null, raw: text };
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const scoreValue = Number(o.score);
  const score = Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, Math.round(scoreValue))) : 50;
  const summary = typeof o.summary === "string" && o.summary.trim() ? o.summary.trim() : "";
  const fit = typeof o.fit === "string" && o.fit.trim() ? o.fit.trim() : "сомнительно";
  const reason = typeof o.reason === "string" && o.reason.trim() ? o.reason.trim() : "";
  const checks = typeof o.checks === "string" && o.checks.trim() ? o.checks.trim() : null;
  if (!summary && !reason) return null;
  return { summary: summary || reason, fit, score, reason: reason || summary, checks };
}

function removeLotAnalyzeAttemptKeys(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(LOT_ANALYZE_ATTEMPT_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

function readLotAnalyzeCache(cacheKey: string): LotAnalyzeResult | null {
  try {
    const raw = localStorage.getItem(LOT_ANALYZE_CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; value?: unknown };
    if (!parsed.ts) return null;
    if (Date.now() - parsed.ts > LOT_ANALYZE_CACHE_TTL_MS) {
      localStorage.removeItem(LOT_ANALYZE_CACHE_PREFIX + cacheKey);
      return null;
    }
    return normalizeLotAnalyzeResult(parsed.value);
  } catch {
    return null;
  }
}

function writeLotAnalyzeCache(cacheKey: string, value: LotAnalyzeResult): void {
  try {
    localStorage.setItem(LOT_ANALYZE_CACHE_PREFIX + cacheKey, JSON.stringify({ ts: Date.now(), value }));
  } catch {
    /* ignore */
  }
}

export async function fetchLotAnalyze(lotText: string, options?: { cacheKey?: string; force?: boolean }): Promise<LotAnalyzeResult | null> {
  const trimmed = lotText.trim();
  if (!trimmed) return null;

  removeLotAnalyzeAttemptKeys();
  const cacheKey = options?.cacheKey || stableHash(trimmed);
  if (!options?.force) {
    const cached = readLotAnalyzeCache(cacheKey);
    if (cached) return cached;
    const pending = lotAnalyzeInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const request = (async () => {
    const base = getRagApiBase();
    const url = `${base}/v1/lot/analyze`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
      body: JSON.stringify({ lot_text: trimmed, profile: readCompanyProfile() }),
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`Анализ лота ${res.status}: ${rawText.slice(0, 240)}`);
    }

    const t = rawText.trim();
    if (!t) return null;

    try {
      const parsed: unknown = JSON.parse(t);
      const result = normalizeLotAnalyzeResult(parsed);
      if (result) {
        writeLotAnalyzeCache(cacheKey, result);
        return result;
      }
    } catch {
      /* не JSON — нормализуем как текст */
    }

    const fallback = normalizeLotAnalyzeResult(t);
    if (fallback) writeLotAnalyzeCache(cacheKey, fallback);
    return fallback;
  })();

  if (!options?.force) lotAnalyzeInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    lotAnalyzeInFlight.delete(cacheKey);
  }
}

export function getFetchDocumentProxyUrl(): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_FETCH_DOCUMENT_PROXY_URL) {
    const u = String(import.meta.env.VITE_FETCH_DOCUMENT_PROXY_URL).trim();
    if (u) return u;
  }
  if (typeof process !== "undefined" && process.env?.VITE_FETCH_DOCUMENT_PROXY_URL) {
    const u = String(process.env.VITE_FETCH_DOCUMENT_PROXY_URL).trim();
    if (u) return u;
  }
  return `${getLocalApiBase()}/api/v1/fetch-document`;
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

export async function fetchDocumentBlobViaBackendProxy(remoteUrl: string): Promise<Blob> {
  const proxy = getFetchDocumentProxyUrl();
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

export function pickTenderDocumentForRag(documents: TenderDocument[] | undefined): TenderDocument | null {
  if (!documents?.length) return null;
  const ok = documents.filter((d) => guessRagDocExtension(d.name, d.downloadLink) !== null);
  if (!ok.length) return null;
  const kw = /спецификац|технич|т\.?\s*з\.?|техзадан/i;
  const preferred = ok.find((d) => kw.test(d.name));
  return preferred ?? ok[0];
}

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

export type IndexLotDocumentResult = {
  indexed: boolean;
  text_chars?: number;
  extracted_text?: string;
  spec_summary?: LotSpecSummary;
};

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
        ? (spec as LotSpecSummary)
        : undefined,
  };
}

function formatRagIndexError(status: number, rawText: string, body: unknown): string {
  const detail =
    body && typeof body === "object" && "detail" in body
      ? String((body as { detail: unknown }).detail)
      : rawText.trim().slice(0, 400);
  if (status === 503) return "AI-выжимка недоступна: не задан GROQ_API_KEY или GEMINI_API_KEY (503).";
  if (status === 502) return `Ошибка AI при выжимке (502): ${detail || "без деталей"}`;
  if (status === 400) return `Не удалось обработать файл (400): ${detail || "пустой файл или формат"}`;
  return `Индексация документа ${status}: ${detail || rawText.slice(0, 240)}`;
}

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

export async function indexLotText(
  lotId: string,
  text: string,
  options?: {
    sourceHint?: string;
    extractSpecPoints?: boolean;
  },
): Promise<IndexLotDocumentResult> {
  const trimmedId = lotId.trim();
  const trimmedText = text.trim();
  if (!trimmedId) throw new Error("Пустой идентификатор лота");
  if (!trimmedText) throw new Error("Пустой текст спецификации");

  const base = getRagApiBase();
  const url = `${base}/v1/lots/${encodeURIComponent(trimmedId)}/index`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: trimmedText,
      source_hint: options?.sourceHint,
      extract_spec_points: options?.extractSpecPoints === true,
    }),
  });
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
