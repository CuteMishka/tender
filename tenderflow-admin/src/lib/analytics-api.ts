import { getLocalApiBase } from "./tenders-api";

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
  won_contracts_count: number;
  won_contracts_amount: number;
  customer_contracts_count: number;
  customer_contracts_amount: number;
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
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status}`);
  }
  return res.json() as Promise<T>;
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
};

export function fmtM(value: number): string {
  if (!value) return "0";
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} млрд`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)} тыс`;
  return value.toFixed(0);
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
