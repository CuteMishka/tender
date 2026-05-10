import { getLocalApiBase } from "./tenders-api";

const base = () => getLocalApiBase();

// ─── Types ────────────────────────────────────────────────────────────────────

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
  start_date: string | null;
  end_date: string | null;
  publish_date: string | null;
  created_at: string;
  updated_at: string;
};

export type AnalyticsStats = {
  total_lots: number;
  total_budget: number;
  avg_amount: number;
  avg_discount: number;
  with_winner: number;
  with_contract: number;
};

export type DynamicsPoint = {
  period: string;
  count: number;
  budget: number;
};

export type WinnerRow = {
  winner_name: string;
  wins: number;
  total_amount: number;
  avg_amount: number;
  max_amount: number;
  market_share_pct: number;
};

export type PriceStats = {
  avg_initial: number;
  avg_contract: number;
  avg_discount_pct: number;
  max_discount_pct: number;
  min_discount_pct: number;
  anomaly_count: number;
  total_savings: number;
};

export type PriceRow = {
  lot_id: number;
  title: string;
  initial_amount: number;
  contract_amount: number;
  discount_abs: number;
  discount_pct: number;
  purchase_type: string;
  customer_name: string;
  winner_name: string;
};

export type TrackedCustomer = {
  id: number;
  customer_name: string;
  customer_id: string;
  notify_email: string;
  notes: string;
  is_favorite: boolean;
  last_checked_at: string | null;
  tender_count: number;
  last_tender_at: string | null;
  total_budget: number;
  created_at: string;
};

export type CustomerCandidate = {
  customer_name: string;
  customer_id: string;
  tender_count: number;
  last_tender_at: string | null;
  total_budget: number;
  is_tracked: boolean;
  is_favorite: boolean;
};

export type LotsFilters = {
  customer?: string;
  purchase_type?: string;
  region?: string;
  winner?: string;
  date_from?: string;
  date_to?: string;
  amount_min?: string;
  amount_max?: string;
  participation?: "our";
  page?: number;
  limit?: number;
};

export type LotsListResponse = {
  items: HistoricalLot[];
  meta: { total: number; page: number; limit: number; pageCount: number };
};

export type FilterOptions = {
  purchase_types: string[];
  regions: string[];
};

export type SyncResult = { fetched: number; upserted: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${base()}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── API Functions ────────────────────────────────────────────────────────────

export const analyticsApi = {
  sync: () => post<SyncResult>("/api/v1/analytics/sync"),

  getLots: (filters: LotsFilters = {}) =>
    get<LotsListResponse>("/api/v1/analytics/lots", {
      customer: filters.customer,
      purchase_type: filters.purchase_type,
      region: filters.region,
      winner: filters.winner,
      date_from: filters.date_from,
      date_to: filters.date_to,
      amount_min: filters.amount_min,
      amount_max: filters.amount_max,
      participation: filters.participation,
      page: filters.page ?? 1,
      limit: filters.limit ?? 20,
    }),

  updateLot: (id: number, data: { winner_name?: string; winner_id?: string; contract_amount?: number; status?: string; region?: string }) =>
    put<{ success: boolean }>(`/api/v1/analytics/lots/${id}`, data),

  getStats: () => get<AnalyticsStats>("/api/v1/analytics/stats"),

  getDynamics: () => get<DynamicsPoint[]>("/api/v1/analytics/dynamics"),

  getFilters: () => get<FilterOptions>("/api/v1/analytics/filters"),

  exportCSV: () => {
    window.open(`${base()}/api/v1/analytics/export`, "_blank");
  },

  getCustomers: () => get<TrackedCustomer[]>("/api/v1/analytics/customers"),

  addCustomer: (data: { customer_name: string; customer_id?: string; notify_email?: string; notes?: string }) =>
    post<TrackedCustomer>("/api/v1/analytics/customers", data),

  updateCustomer: (id: number, data: { customer_name: string; customer_id?: string; notify_email?: string; notes?: string; is_favorite: boolean }) =>
    put<TrackedCustomer>(`/api/v1/analytics/customers/${id}`, data),

  getCustomerCandidates: (q = "", limit = 80) =>
    get<CustomerCandidate[]>("/api/v1/analytics/customers/candidates", { q, limit }),

  deleteCustomer: (id: number) => del<{ success: boolean }>(`/api/v1/analytics/customers/${id}`),

  getCustomerLots: (id: number) =>
    get<{ customer: TrackedCustomer; lots: HistoricalLot[] }>(`/api/v1/analytics/customers/${id}/lots`),

  getWinners: () => get<WinnerRow[]>("/api/v1/analytics/winners"),

  getPrices: () => get<{ stats: PriceStats; rows: PriceRow[] }>("/api/v1/analytics/prices"),
};

// ─── Formatters ───────────────────────────────────────────────────────────────

export function fmtM(v: number): string {
  if (!v) return "—";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} млрд`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)} тыс`;
  return v.toFixed(0);
}

export function fmtN(v: number): string {
  if (!v) return "—";
  return new Intl.NumberFormat("ru-RU").format(v);
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-KZ");
}

export function fmtPct(v: number): string {
  if (!v) return "—";
  return `${v.toFixed(1)}%`;
}
