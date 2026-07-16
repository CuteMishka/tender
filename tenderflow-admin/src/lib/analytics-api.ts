import { getLocalApiBase } from "./tenders-api";
import { apiFetch } from "./api-client.ts";

const base = () => getLocalApiBase();

export type CompanyMatch = {
  name: string;
  bin: string;
  roles: string[];
  score: number;
};

export type CompanySummary = {
  published_count: number;
  active_published_count: number;
  published_budget: number;
  published_amount_count?: number;
  won_contracts_count: number;
  won_contracts_amount: number;
  won_contracts_amount_count?: number;
  customer_contracts_count: number;
  customer_contracts_amount: number;
  customer_contracts_amount_count?: number;
  participated_count: number;
  last_activity_at: string | null;
  confidence: "high" | "medium" | "low" | string;
};

export type CompanyInsight = {
  kind: string;
  title: string;
  message: string;
  severity: "success" | "info" | "warning" | "error" | string;
};

export type CompanyTender = {
  id: number;
  lot_number: string;
  title: string;
  amount: number;
  amount_available?: boolean;
  status: string;
  customer_name: string;
  customer_bin: string;
  organizer: string;
  platform: string;
  purchase_type: string;
  region: string;
  begin_date: string | null;
  end_date: string | null;
  publish_date: string | null;
  link: string;
};

export type CompanyContract = {
  id: number;
  contract_number: string;
  amount: number;
  amount_available?: boolean;
  sign_date: string | null;
  status: string;
  supplier_name: string;
  supplier_bin: string;
  customer_name: string;
  customer_bin: string;
  tender_number: string;
  tender_title: string;
};

export type CompanyOffer = {
  id: number;
  lot_id: number;
  amount: number;
  amount_available?: boolean;
  discount_price: number;
  request_date: string | null;
  status: string;
  organization: string;
  organization_bin: string;
  lot: CompanyTender | null;
};

export type CompanyMonthlyPoint = {
  label: string;
  published: number;
  won: number;
  customer: number;
  participated: number;
  publishedAmount: number;
  wonAmount: number;
  customerAmount: number;
};

export type CompanyNamedValue = {
  name: string;
  value: number;
};

export type CompanyNamedMoney = {
  name: string;
  count: number;
  amount: number;
};

export type CompanyRecentEvent = {
  kind: "published" | "won" | "customer_contract" | "participated" | string;
  title: string;
  subtitle: string;
  amount: number;
  amount_available?: boolean;
  status: string;
  date: string | null;
  link: string;
};

export type CompanyAggregates = {
  monthly: CompanyMonthlyPoint[];
  status_mix: CompanyNamedValue[];
  platform_mix: CompanyNamedValue[];
  purchase_mix: CompanyNamedValue[];
  counterparties: CompanyNamedMoney[];
  opportunities: CompanyTender[];
  recent: CompanyRecentEvent[];
};

export type CompanyTenderIntelligence = {
  query: string;
  generated_at: string;
  source: string;
  matches: CompanyMatch[];
  summary: CompanySummary;
  insights: CompanyInsight[];
  aggregates?: CompanyAggregates;
  published: CompanyTender[];
  won_contracts: CompanyContract[];
  customer_contracts: CompanyContract[];
  participated: CompanyOffer[];
  warnings?: string[];
};

export type AnalyticsReportRequest = {
  organization_query: string;
  organization?: string;
  platforms?: string[];
  date_from?: string;
  date_to?: string;
  top_n?: number;
};

export type AnalyticsReportHeader = {
  title: string;
  organization_query: string;
  organization_filter?: string;
  organizations: string[];
  platforms: string[];
  date_from?: string;
  date_to?: string;
  data_as_of: string;
  generated_at: string;
  source: string;
  timezone: string;
  date_basis: string;
  deduplication_method: string;
  amount_calculation_note: string;
};

export type AnalyticsReportKPIs = {
  total_lots: number;
  completed_lots: number;
  cancelled_lots: number;
  failed_lots: number;
  lots_without_amount: number;
  total_amount: number;
  possible_reannouncements: number;
};

export type AnalyticsReportBreakdown = {
  name: string;
  count: number;
  amount: number;
};

export type AnalyticsReportStatus =
  | "cancelled"
  | "failed"
  | "completed"
  | "active"
  | "unknown"
  | string;

export type AnalyticsReportTopTender = {
  lot_number: string;
  lot_source?: string;
  title: string;
  amount: number;
  amount_available: boolean;
  deadline?: string | null;
  status: string;
  status_group: AnalyticsReportStatus;
  platform: string;
  organization: string;
  possible_reannouncement: boolean;
};

export type AnalyticsReportRepeatedLot = {
  lot_number: string;
  lot_source?: string;
  title: string;
  platform: string;
  occurrences: number;
  publication_count: number;
  stage_transition: boolean;
  possible_reannouncement: boolean;
  status: string;
};

export type AnalyticsReportQuality = {
  source_rows: number;
  filtered_rows: number;
  unique_lots: number;
  rows_without_lot_number: number;
  rows_without_lot_source: number;
  lots_with_unknown_status: number;
  lots_with_conflicting_amounts: number;
  lots_using_amount_fallback: number;
  past_deadline_active_lots: number;
  warnings?: string[];
};

export type AnalyticsReportPreview = {
  header: AnalyticsReportHeader;
  kpis: AnalyticsReportKPIs;
  by_purchase_type: AnalyticsReportBreakdown[];
  by_service_category: AnalyticsReportBreakdown[];
  top_tenders: AnalyticsReportTopTender[];
  repeated_lots: AnalyticsReportRepeatedLot[];
  conclusions: string[];
  quality: AnalyticsReportQuality;
  available_platforms: string[];
  available_organizations: string[];
};

export type AnalyticsReportDownload = {
  blob: Blob;
  filename: string;
};

export type HistoricalLot = {
  id: number;
  lot_id: number;
  title: string;
  description: string;
  initial_amount: number;
  contract_amount: number;
  status: string;
  customer_name: string;
  customer_id: string;
  organizer_name: string;
  region: string;
  purchase_type: string;
  winner_name: string;
  winner_id: string;
  partner_link: string;
  lot_source: string;
  excluded_from_analytics: boolean;
  start_date: string | null;
  end_date: string | null;
  publish_date: string | null;
  created_at: string;
  updated_at: string;
};

export type LotsFilters = {
  customer?: string;
  purchase_type?: string;
  region?: string;
  winner?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  amount_min?: string;
  amount_max?: string;
  participation?: "our";
  excluded?: "include" | "only";
  page?: number;
  limit?: number;
};

export type LotsListResponse = {
  items: HistoricalLot[];
  meta: { total: number; page: number; limit: number; pageCount: number };
};

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${base()}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const res = await apiFetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(`${base()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await responseError(res));
  return res.json() as Promise<T>;
}

async function postBlob(path: string, body: unknown): Promise<AnalyticsReportDownload> {
  const res = await apiFetch(`${base()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await responseError(res));
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("Сервер вернул пустой файл справки");
  return {
    blob,
    filename:
      filenameFromDisposition(res.headers.get("Content-Disposition")) || "analytics-report.docx",
  };
}

async function responseError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `Ошибка сервера (${res.status})`;
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || text;
  } catch {
    return text;
  }
}

function filenameFromDisposition(value: string | null): string {
  if (!value) return "";
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded).replace(/[\\/:*?"<>|]+/g, "_");
    } catch {
      // fall through to the regular filename parameter
    }
  }
  const plain = value.match(/filename="([^"]+)"/i)?.[1] || value.match(/filename=([^;]+)/i)?.[1];
  return (plain || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
}

export const analyticsApi = {
  getCompanyTenders: (q: string, limit = 25) =>
    get<CompanyTenderIntelligence>("/api/v1/analytics/company-tenders", { q, limit }),

  getLots: (filters: LotsFilters = {}) =>
    get<LotsListResponse>("/api/v1/analytics/lots", {
      customer: filters.customer,
      purchase_type: filters.purchase_type,
      region: filters.region,
      winner: filters.winner,
      status: filters.status,
      date_from: filters.date_from,
      date_to: filters.date_to,
      amount_min: filters.amount_min,
      amount_max: filters.amount_max,
      participation: filters.participation,
      excluded: filters.excluded,
      page: filters.page ?? 1,
      limit: filters.limit ?? 20,
    }),

  previewReport: (request: AnalyticsReportRequest) =>
    post<AnalyticsReportPreview>("/api/v1/analytics/reports/preview", request),

  downloadReportDocx: (request: AnalyticsReportRequest) =>
    postBlob("/api/v1/analytics/reports/docx", request),
};

export function fmtM(value: number): string {
  if (!value) return "0";
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} млрд`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)} тыс`;
  return value.toFixed(0);
}

export function hasKnownAmount(value: number | null | undefined, amountAvailable?: boolean): boolean {
  if (amountAvailable === false) return false;
  return typeof value === "number" && value > 0;
}

export function fmtMoney(value: number | null | undefined, amountAvailable?: boolean): string {
  return hasKnownAmount(value, amountAvailable) ? `₸ ${fmtM(Number(value))}` : "—";
}

export function fmtN(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value || 0);
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-KZ");
}

export function fmtLotNumber(value: string | number | null | undefined, fallback?: string | number): string {
  const raw = String(value ?? "").replace(/\s*\(\s*\)\s*$/g, "").trim();
  if (raw) return raw;
  const fallbackRaw = String(fallback ?? "").replace(/\s*\(\s*\)\s*$/g, "").trim();
  return fallbackRaw || "—";
}
