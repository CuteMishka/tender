import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Banknote,
  Building2,
  CalendarClock,
  Clock,
  CircleDollarSign,
  FileSearch,
  Gavel,
  Loader2,
  PieChart as PieChartIcon,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/admin/PageHeader";
import {
  analyticsApi,
  fmtDate,
  fmtLotNumber,
  fmtM,
  fmtN,
  type CompanyContract,
  type CompanyRecentEvent,
  type CompanyTender,
  type CompanyTenderIntelligence,
} from "@/lib/analytics-api";

export const Route = createFileRoute("/_admin/analytics")({
  component: Analytics,
});

const quickQueries = ["201040033189", "Tender Mobile", "Витанова", "Қазақтелеком"];
const palette = ["#0f766e", "#2563eb", "#d97706", "#be123c", "#475569", "#7c3aed"];

function Analytics() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CompanyTenderIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    let active = true;
    setLoading(true);
    setError("");
    analyticsApi.getCompanyTenders(q, 100)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((err: Error) => {
        if (active) {
          setResult(null);
          setError(readableError(err.message));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [query]);

  const model = useMemo(() => result ? buildModel(result) : null, [result]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = draft.trim();
    if (q.length >= 2) setQuery(q);
  };

  const setFastQuery = (value: string) => {
    setDraft(value);
    setQuery(value);
  };

  return (
    <>
      <PageHeader
        title="Аналитика"
        description="Тендерная разведка по компаниям: спрос, победы, контрагенты, риски и возможности"
        actions={
          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <Activity className="h-4 w-4 text-primary" />
            TenderPlus API
          </div>
        }
      />

      <div className="space-y-5 p-8">
        <section className="rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Введите название компании или БИН"
                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>
            <button
              type="submit"
              disabled={draft.trim().length < 2 || loading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Проанализировать
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            {quickQueries.map((item) => (
              <button
                key={item}
                onClick={() => setFastQuery(item)}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                {item}
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && !result && <LoadingState />}

        {!loading && !result && !error && (
          <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Введите компанию, чтобы собрать аналитику из TenderPlus.
          </div>
        )}

        {result && model && (
          <>
            <section className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <CompanyProfile result={result} model={model} />
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard icon={Activity} label="Активность" value={fmtN(model.totalEvents)} detail="лоты, договоры, заявки" />
                <KpiCard icon={Banknote} label="Деньги в анализе" value={`₸ ${fmtM(model.totalAmount)}`} detail="публикации и договоры" />
                <KpiCard icon={Gavel} label="Средний лот" value={`₸ ${fmtM(model.avgPublishedLot)}`} detail="по опубликованным закупкам" />
                <KpiCard icon={Trophy} label="Индекс побед" value={`${model.winIndex}%`} detail="победы к участию" />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr_0.9fr]">
              <ChartCard title="Динамика активности" icon={CalendarClock}>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={model.monthly}>
                    <defs>
                      <linearGradient id="publishedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0f766e" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#0f766e" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="wonFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <Tooltip formatter={(value: number) => fmtN(value)} />
                    <Area type="monotone" dataKey="published" name="Публикации" stroke="#0f766e" fill="url(#publishedFill)" strokeWidth={2} />
                    <Area type="monotone" dataKey="won" name="Победы" stroke="#2563eb" fill="url(#wonFill)" strokeWidth={2} />
                    <Area type="monotone" dataKey="customer" name="Договоры заказчика" stroke="#d97706" fill="#d977061a" strokeWidth={2} />
                    <Legend />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Роли компании" icon={Target}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={model.roleBars} layout="vertical" margin={{ left: 16, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis dataKey="name" type="category" width={96} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => fmtN(value)} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {model.roleBars.map((entry, index) => (
                        <Cell key={entry.name} fill={palette[index % palette.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Статусы лотов" icon={PieChartIcon}>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={model.statusMix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={92} paddingAngle={2}>
                      {model.statusMix.map((entry, index) => (
                        <Cell key={entry.name} fill={palette[index % palette.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => fmtN(value)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <ChartCard title="Деньги по месяцам" icon={CircleDollarSign}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={model.monthly}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(value) => fmtM(Number(value))} />
                    <Tooltip formatter={(value: number) => `₸ ${fmtM(value)}`} />
                    <Bar dataKey="publishedAmount" name="Бюджет публикаций" fill="#0f766e" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="wonAmount" name="Победы" fill="#2563eb" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="customerAmount" name="Договоры заказчика" fill="#d97706" radius={[6, 6, 0, 0]} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="grid gap-4 md:grid-cols-2">
                <Distribution title="Площадки" icon={BarChart3} items={model.platformMix} />
                <Distribution title="Типы закупок" icon={FileSearch} items={model.purchaseMix} />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
              <SignalPanel model={model} result={result} />
              <CounterpartyPanel contracts={model.counterparties} />
            </section>

            <RecentActivityPanel items={model.recent} />

            <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
              <OpportunityTable items={model.opportunities} />
              <InsightStack model={model} result={result} />
            </section>

            {result.warnings && result.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {result.warnings.slice(0, 2).join(" ")}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function CompanyProfile({ result, model }: { result: CompanyTenderIntelligence; model: AnalyticsModel }) {
  const match = result.matches[0];
  return (
    <section className="rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{match?.name || result.query}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {match?.bin || "БИН не найден"}
            </span>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
              {model.profile}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 text-sm">
        <MetricRow label="Публикует тендеры" value={fmtN(result.summary.published_count)} />
        <MetricRow label="Выигрывает договоры" value={fmtN(result.summary.won_contracts_count)} />
        <MetricRow label="Покупает / публикует" value={`${fmtN(model.buyingCount)} · ₸ ${fmtM(model.buyingAmount)}`} />
        <MetricRow label="Последняя активность" value={fmtDate(result.summary.last_activity_at)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(match?.roles || []).map((role) => (
          <span key={role} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
            <BadgeCheck className="h-3 w-3 text-primary" />
            {role}
          </span>
        ))}
      </div>
    </section>
  );
}

function KpiCard({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Distribution({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: NamedValue[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <section className="rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Нет данных</p>
        ) : items.slice(0, 6).map((item, index) => {
          const pct = Math.round((item.value / total) * 100);
          return (
            <div key={item.name}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{item.name}</span>
                <span className="font-medium">{fmtN(item.value)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: palette[index % palette.length] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SignalPanel({ model, result }: { model: AnalyticsModel; result: CompanyTenderIntelligence }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="mb-4 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Сигналы специалиста по тендерам</h3>
      </div>
      <div className="space-y-3">
        {model.signals.map((signal) => (
          <div key={signal.title} className={`rounded-lg border p-4 ${signalClass(signal.severity)}`}>
            <p className="text-sm font-semibold">{signal.title}</p>
            <p className="mt-1 text-xs leading-5 opacity-85">{signal.text}</p>
          </div>
        ))}
        {result.insights.slice(0, 2).map((insight) => (
          <div key={insight.title} className={`rounded-lg border p-4 ${signalClass(insight.severity)}`}>
            <p className="text-sm font-semibold">{insight.title}</p>
            <p className="mt-1 text-xs leading-5 opacity-85">{insight.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CounterpartyPanel({ contracts }: { contracts: NamedMoney[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Контрагенты по договорам</h3>
      </div>
      {contracts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          TenderPlus не вернул договоры для этой компании.
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((item, index) => (
            <div key={`${item.name}-${index}`} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{fmtN(item.count)} договоров</p>
                </div>
                <p className="shrink-0 text-sm font-semibold">₸ {fmtM(item.amount)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentActivityPanel({ items }: { items: CompanyRecentEvent[] }) {
  return (
    <section className="rounded-lg border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Недавние события</h3>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{fmtN(items.length)}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">Нет недавних событий</div>
      ) : (
        <div className="divide-y divide-border">
          {items.slice(0, 8).map((item, index) => (
            <div key={`${item.kind}-${item.date}-${index}`} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {recentKindLabel(item.kind)}
                  </span>
                  {item.status && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{item.status}</span>}
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium">{item.title || "Без названия"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.subtitle || "—"}</p>
              </div>
              <div className="text-sm font-semibold">₸ {fmtM(item.amount)}</div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{fmtDate(item.date)}</span>
                {item.link && (
                  <a href={item.link} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent" title="Открыть">
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OpportunityTable({ items }: { items: CompanyTender[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Ближайшие тендерные возможности</h3>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{fmtN(items.length)}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">Нет активных публикаций с дедлайном</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Лот</th>
                <th className="px-5 py-3 text-left font-medium">Компания</th>
                <th className="px-5 py-3 text-left font-medium">Статус</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-5 py-3 text-left font-medium">Дедлайн</th>
                <th className="px-5 py-3 text-left font-medium">Площадка</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 8).map((item) => (
                <tr key={item.id} className="border-t border-border hover:bg-muted/30">
                  <td className="max-w-[340px] px-5 py-4">
                    <p className="line-clamp-2 font-medium">{item.title || "Без названия"}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">Лот № {fmtLotNumber(item.lot_number, item.id)}</p>
                  </td>
                  <td className="max-w-[260px] px-5 py-4">
                    <p className="line-clamp-2">{item.customer_name || item.organizer || "—"}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{item.customer_bin || "—"}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{item.status || "—"}</span>
                  </td>
                  <td className="px-5 py-4 text-right font-medium">₸ {fmtM(item.amount)}</td>
                  <td className="px-5 py-4 text-muted-foreground">{fmtDate(item.end_date)}</td>
                  <td className="px-5 py-4 text-muted-foreground">{item.platform || "—"}</td>
                  <td className="px-5 py-4 text-right">
                    {item.link && (
                      <a href={item.link} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent" title="Открыть">
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    )}
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

function InsightStack({ model, result }: { model: AnalyticsModel; result: CompanyTenderIntelligence }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Что делать дальше</h3>
      </div>
      <div className="space-y-3">
        {model.nextSteps.map((item) => (
          <div key={item} className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 text-sm">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
        Срез построен по запросу “{result.query}”, найдено {fmtN(model.totalEvents)} событий.
      </div>
    </section>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
      <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
      Собираю аналитику TenderPlus
    </div>
  );
}

type NamedValue = { name: string; value: number };
type NamedMoney = { name: string; count: number; amount: number };
type Signal = { title: string; text: string; severity: string };

type AnalyticsModel = {
  profile: string;
  totalEvents: number;
  totalAmount: number;
  buyingCount: number;
  buyingAmount: number;
  avgPublishedLot: number;
  winIndex: number;
  roleBars: NamedValue[];
  statusMix: NamedValue[];
  platformMix: NamedValue[];
  purchaseMix: NamedValue[];
  monthly: Array<{
    label: string;
    published: number;
    won: number;
    customer: number;
    participated: number;
    publishedAmount: number;
    wonAmount: number;
    customerAmount: number;
  }>;
  counterparties: NamedMoney[];
  opportunities: CompanyTender[];
  recent: CompanyRecentEvent[];
  signals: Signal[];
  nextSteps: string[];
};

function buildModel(result: CompanyTenderIntelligence): AnalyticsModel {
  const summary = result.summary;
  const buyingCount = summary.customer_contracts_count || summary.published_count;
  const buyingAmount = summary.customer_contracts_amount || summary.published_budget;
  const totalEvents = summary.published_count + summary.won_contracts_count + summary.customer_contracts_count + summary.participated_count;
  const totalAmount = summary.published_budget + summary.won_contracts_amount + summary.customer_contracts_amount;
  const avgPublishedLot = summary.published_count ? summary.published_budget / summary.published_count : 0;
  const winIndex = summary.participated_count ? Math.round((summary.won_contracts_count / summary.participated_count) * 100) : summary.won_contracts_count > 0 ? 100 : 0;

  const roleBars = [
    { name: "Публикует", value: summary.published_count },
    { name: "Активно", value: summary.active_published_count },
    { name: "Выигрывает", value: summary.won_contracts_count },
    { name: "Покупает", value: buyingCount },
    { name: "Участвует", value: summary.participated_count },
  ].filter((item) => item.value > 0);

  const profile = dominantProfile(summary);
  const aggregate = result.aggregates;
  const statusMix = aggregate?.status_mix?.length ? aggregate.status_mix : groupByCount(result.published, (item) => item.status || "Без статуса");
  const platformMix = aggregate?.platform_mix?.length ? aggregate.platform_mix : groupByCount(result.published, (item) => item.platform || "Площадка не указана");
  const purchaseMix = aggregate?.purchase_mix?.length ? aggregate.purchase_mix : groupByCount(result.published, (item) => item.purchase_type || "Тип не указан");
  const monthly = aggregate?.monthly?.length ? aggregate.monthly : buildMonthly(result);
  const counterparties = aggregate?.counterparties?.length ? aggregate.counterparties : buildCounterparties(result.won_contracts, result.customer_contracts);
  const recent = aggregate?.recent?.length ? aggregate.recent : buildRecentEvents(result);
  const opportunities = aggregate?.opportunities?.length ? aggregate.opportunities : result.published
    .filter((item) => isFutureDate(item.end_date) || isLikelyActive(item.status))
    .sort((a, b) => {
      const ad = dateValue(a.end_date) || Number.MAX_SAFE_INTEGER;
      const bd = dateValue(b.end_date) || Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return (b.amount || 0) - (a.amount || 0);
    });

  const signals = buildSignals(result, statusMix, platformMix);
  const nextSteps = buildNextSteps(result, profile, opportunities.length);

  return {
    profile,
    totalEvents,
    totalAmount,
    buyingCount,
    buyingAmount,
    avgPublishedLot,
    winIndex,
    roleBars: roleBars.length ? roleBars : [{ name: "Нет данных", value: 1 }],
    statusMix,
    platformMix,
    purchaseMix,
    monthly,
    counterparties,
    opportunities,
    recent,
    signals,
    nextSteps,
  };
}

function dominantProfile(summary: CompanyTenderIntelligence["summary"]): string {
  if (summary.published_count >= Math.max(summary.won_contracts_count, summary.customer_contracts_count, summary.participated_count)) {
    return "Заказчик / инициатор закупок";
  }
  if (summary.won_contracts_count >= Math.max(summary.customer_contracts_count, summary.participated_count)) {
    return "Поставщик с победами";
  }
  if (summary.participated_count > 0) return "Активный участник";
  return "Профиль требует уточнения";
}

function groupByCount<T>(items: T[], pick: (item: T) => string): NamedValue[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = pick(item).trim() || "Не указано";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);
}

function buildMonthly(result: CompanyTenderIntelligence): AnalyticsModel["monthly"] {
  const months = new Map<string, AnalyticsModel["monthly"][number]>();
  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date();
    date.setMonth(date.getMonth() - i, 1);
    const key = monthKey(date.toISOString());
    months.set(key, emptyMonth(key));
  }

  for (const item of result.published) {
    const key = monthKey(item.publish_date || item.end_date || item.begin_date);
    const row = months.get(key);
    if (row) {
      row.published += 1;
      row.publishedAmount += item.amount || 0;
    }
  }
  for (const item of result.won_contracts) {
    const key = monthKey(item.sign_date);
    const row = months.get(key);
    if (row) {
      row.won += 1;
      row.wonAmount += item.amount || 0;
    }
  }
  for (const item of result.customer_contracts) {
    const key = monthKey(item.sign_date);
    const row = months.get(key);
    if (row) {
      row.customer += 1;
      row.customerAmount += item.amount || 0;
    }
  }
  for (const item of result.participated) {
    const key = monthKey(item.request_date);
    const row = months.get(key);
    if (row) row.participated += 1;
  }
  return [...months.values()];
}

function buildRecentEvents(result: CompanyTenderIntelligence): CompanyRecentEvent[] {
  const events: CompanyRecentEvent[] = [];
  for (const item of result.published) {
    events.push({
      kind: "published",
      title: item.title,
      subtitle: item.platform,
      amount: item.amount,
      status: item.status,
      date: item.publish_date || item.end_date || item.begin_date,
      link: item.link,
    });
  }
  for (const item of result.won_contracts) {
    events.push({
      kind: "won",
      title: item.tender_title,
      subtitle: item.customer_name,
      amount: item.amount,
      status: item.status,
      date: item.sign_date,
      link: "",
    });
  }
  for (const item of result.customer_contracts) {
    events.push({
      kind: "customer_contract",
      title: item.tender_title,
      subtitle: item.supplier_name,
      amount: item.amount,
      status: item.status,
      date: item.sign_date,
      link: "",
    });
  }
  for (const item of result.participated) {
    events.push({
      kind: "participated",
      title: item.lot?.title || `Лот ${item.lot_id}`,
      subtitle: item.organization,
      amount: item.discount_price || item.amount,
      status: item.status,
      date: item.request_date,
      link: item.lot?.link || "",
    });
  }
  return events
    .sort((a, b) => (dateValue(b.date) || 0) - (dateValue(a.date) || 0))
    .slice(0, 12);
}

function recentKindLabel(kind: string): string {
  if (kind === "won") return "Победа";
  if (kind === "customer_contract") return "Договор";
  if (kind === "participated") return "Заявка";
  return "Публикация";
}

function emptyMonth(key: string): AnalyticsModel["monthly"][number] {
  const [year, month] = key.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
  return { label, published: 0, won: 0, customer: 0, participated: 0, publishedAmount: 0, wonAmount: 0, customerAmount: 0 };
}

function monthKey(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return monthKey(new Date().toISOString());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildCounterparties(won: CompanyContract[], customer: CompanyContract[]): NamedMoney[] {
  const map = new Map<string, NamedMoney>();
  const add = (name: string, amount: number) => {
    const key = name.trim() || "Не указано";
    const existing = map.get(key) || { name: key, count: 0, amount: 0 };
    existing.count += 1;
    existing.amount += amount || 0;
    map.set(key, existing);
  };
  won.forEach((item) => add(item.customer_name, item.amount));
  customer.forEach((item) => add(item.supplier_name, item.amount));
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
}

function buildSignals(result: CompanyTenderIntelligence, statusMix: NamedValue[], platformMix: NamedValue[]): Signal[] {
  const signals: Signal[] = [];
  const nearDeadline = result.published.filter((item) => daysUntil(item.end_date) !== null && Number(daysUntil(item.end_date)) <= 5 && Number(daysUntil(item.end_date)) >= 0).length;
  if (nearDeadline > 0) {
    signals.push({
      title: "Есть срочные дедлайны",
      text: `${nearDeadline} активных лотов закрываются в ближайшие 5 дней. Их стоит вынести в отдельный контроль, чтобы не пропустить обеспечение и документы.`,
      severity: "warning",
    });
  }
  if (result.summary.published_count > 0 && result.summary.won_contracts_count === 0) {
    signals.push({
      title: "Компания выглядит как заказчик",
      text: "В найденном срезе есть публикации закупок, но нет побед как поставщика. Для продаж важнее смотреть её закупочный календарь и типовые категории.",
      severity: "info",
    });
  }
  const topPlatform = platformMix[0];
  const platformTotal = platformMix.reduce((sum, item) => sum + item.value, 0);
  if (topPlatform && platformTotal > 0 && topPlatform.value / platformTotal >= 0.7) {
    signals.push({
      title: "Высокая концентрация на площадке",
      text: `${topPlatform.name} даёт большую часть найденных закупок. Настройки мониторинга и документы лучше проверить именно под эту площадку.`,
      severity: "success",
    });
  }
  const topStatus = statusMix[0];
  if (topStatus && topStatus.value >= 10) {
    signals.push({
      title: "Повторяющийся статус закупок",
      text: `Чаще всего встречается статус “${topStatus.name}”. Это помогает быстро отделять живые возможности от архивного шума.`,
      severity: "info",
    });
  }
  if (signals.length === 0) {
    signals.push({
      title: "Данных пока немного",
      text: "Можно искать по точному БИН: так TenderPlus чаще возвращает договоры и участия без лишних совпадений по названию.",
      severity: "info",
    });
  }
  return signals.slice(0, 4);
}

function buildNextSteps(result: CompanyTenderIntelligence, profile: string, opportunities: number): string[] {
  const steps = [
    "Проверить топовые типы закупок и добавить их в словарь ключевых слов мониторинга.",
    "Открыть ближайшие лоты с крупной суммой и оценить требования по обеспечению, срокам и документам.",
  ];
  if (profile.includes("Заказчик")) {
    steps.push("Собрать шаблон коммерческого предложения под повторяющиеся категории закупок этой компании.");
  }
  if (result.summary.won_contracts_count > 0) {
    steps.push("Разобрать выигранные договоры: суммы, заказчиков и периодичность побед для прогноза следующих возможностей.");
  }
  if (opportunities === 0) {
    steps.push("Повторить поиск по БИН или юридическому названию, если нужны только точные активные публикации.");
  }
  return steps.slice(0, 4);
}

function isLikelyActive(status: string): boolean {
  const value = status.toLowerCase();
  return value.includes("прием") || value.includes("приём") || value.includes("актив") || value.includes("опублик");
}

function isFutureDate(value: string | null | undefined): boolean {
  const ts = dateValue(value);
  return Boolean(ts && ts >= Date.now());
}

function dateValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function daysUntil(value: string | null | undefined): number | null {
  const ts = dateValue(value);
  if (!ts) return null;
  return Math.ceil((ts - Date.now()) / 86_400_000);
}

function signalClass(severity: string): string {
  if (severity === "success") return "border-green-200 bg-green-50 text-green-800";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  if (severity === "error") return "border-red-200 bg-red-50 text-red-800";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function readableError(message: string): string {
  try {
    const parsed = JSON.parse(message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // keep original message
  }
  return message.replace(/^"|"$/g, "") || "TenderPlus временно недоступен";
}
