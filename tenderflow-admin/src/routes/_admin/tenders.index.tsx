import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { ExternalLink, Filter, MoreVertical } from "lucide-react";
import {
  fetchTendersList,
  formatTenderAmount,
  sanitizeApiText,
  type TendersListResponse,
} from "@/lib/tenders-api";

type TendersSearch = { page: number };

function pageFromLocation(location: { search: unknown; searchStr?: string }): number {
  const s = location.search;
  if (typeof s === "object" && s !== null && "page" in s) {
    const p = Number((s as { page: unknown }).page);
    if (Number.isFinite(p) && p >= 1) return Math.floor(p);
  }
  const raw = location.searchStr ?? "";
  const q = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const p = Number(q.get("page"));
  return Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1;
}

export const Route = createFileRoute("/_admin/tenders/")({
  validateSearch: (raw: Record<string, unknown>): TendersSearch => {
    const page = Number(raw.page);
    return { page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1 };
  },
  ssr: false,
  component: TendersList,
});

function truncate(s: string, max: number) {
  const t = sanitizeApiText(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function TendersList() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageFromLocation(location);
  const [data, setData] = useState<TendersListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTendersList({ page, limit: 10 })
      .then((d) => {
        if (!cancelled) setData(d);
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
  }, [page]);

  return (
    <>
      <PageHeader
        title="Тендеры"
        actions={
          <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
            <Filter className="h-4 w-4" /> Фильтры
          </button>
        }
      />

      <div className="p-8">
        <div className="mb-4 flex flex-wrap gap-2">
          {["Все", "Активные", "На проверке", "Завершённые", "Отклонённые"].map((tab, i) => (
            <button
              key={tab}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${i === 0 ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground hover:bg-accent"}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div
          className="overflow-hidden rounded-xl border border-border bg-card"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          {loading && !data ? (
            <div className="flex items-center justify-center px-6 py-24 text-sm text-muted-foreground">
              Загрузка…
            </div>
          ) : data ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium">ID / закупка</th>
                      <th className="px-6 py-3 text-left font-medium">Лот / источник</th>
                      <th className="px-6 py-3 text-left font-medium">Тендер</th>
                      <th className="px-6 py-3 text-right font-medium">Сумма ₸</th>
                      <th className="px-6 py-3 text-left font-medium">Место</th>
                      <th className="px-6 py-3 text-center font-medium">Ссылка</th>
                      <th className="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((t) => (
                      <tr
                        key={t.id}
                        role="link"
                        tabIndex={0}
                        className="cursor-pointer border-t border-border transition hover:bg-muted/40"
                        onClick={() =>
                          navigate({
                            to: "/tenders/$tenderId",
                            params: { tenderId: String(t.id) },
                            state: { tendersPage: page },
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate({
                              to: "/tenders/$tenderId",
                              params: { tenderId: String(t.id) },
                              state: { tendersPage: page },
                            });
                          }
                        }}
                      >
                        <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                          <div>{t.id}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground/80">
                            buy_id {t.buy_id}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-foreground">
                          <div>{t.lot}</div>
                          {t.lot_source_id ? (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {t.lot_source_id}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-6 py-4">
                          <div className="max-w-md font-medium text-foreground">
                            {truncate(t.title, 120)}
                          </div>
                          <div className="mt-1 max-w-md text-xs text-muted-foreground">
                            {truncate(t.description, 160)}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-semibold tabular-nums">
                          {formatTenderAmount(t.cost)}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          <span className="line-clamp-3 max-w-xs">{truncate(t.place, 180)}</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <a
                            href={t.partnerLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex rounded-md p-2 text-primary hover:bg-accent"
                            title="Открыть на площадке"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3 text-sm text-muted-foreground">
                <span>
                  Стр. {page} из {Math.max(1, data.meta.pageCount || 1)} · записей:{" "}
                  {data.items.length} · всего по запросу: {data.meta.totalCount}
                  {loading ? " · обновление…" : ""}
                </span>
                <div className="flex flex-wrap gap-1">
                  <Link
                    to="/tenders"
                    search={{ page: Math.max(1, page - 1) }}
                    className={`rounded-md border border-border px-3 py-1 hover:bg-accent ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
                  >
                    ←
                  </Link>
                  {Array.from(
                    { length: Math.max(1, data.meta.pageCount || 1) },
                    (_, i) => i + 1,
                  ).map((p) => (
                    <Link
                      key={p}
                      to="/tenders"
                      search={{ page: p }}
                      className={`rounded-md px-3 py-1 ${p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}
                    >
                      {p}
                    </Link>
                  ))}
                  <Link
                    to="/tenders"
                    search={{ page: Math.min(Math.max(1, data.meta.pageCount || 1), page + 1) }}
                    className={`rounded-md border border-border px-3 py-1 hover:bg-accent ${page >= (data.meta.pageCount || 1) ? "pointer-events-none opacity-40" : ""}`}
                  >
                    →
                  </Link>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
