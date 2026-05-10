import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { ToastContainer, useToast } from "@/components/admin/PageToast";
import { Building2, Plus, Trash2, History, X, Mail, Hash, DollarSign, Calendar, Search, Star, RefreshCw } from "lucide-react";
import { analyticsApi, fmtM, fmtDate, fmtN, type TrackedCustomer, type HistoricalLot, type CustomerCandidate } from "@/lib/analytics-api";
import { pushNotification } from "@/hooks/use-notifications";

export const Route = createFileRoute("/_admin/analytics/customers")({
  component: CustomersAnalytics,
});

function CustomersAnalytics() {
  const toast = useToast();
  const [customers, setCustomers] = useState<TrackedCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TrackedCustomer | null>(null);
  const [formName, setFormName] = useState("");
  const [formCustomerId, setFormCustomerId] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState<CustomerCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [customerLots, setCustomerLots] = useState<{ customer: TrackedCustomer; lots: HistoricalLot[] } | null>(null);
  const [lotsLoading, setLotsLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setCustomers((await analyticsApi.getCustomers()) ?? []);
    } catch (e) {
      toast.error(`Ошибка загрузки: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadCandidates = async (q = candidateQuery) => {
    setCandidatesLoading(true);
    try {
      setCandidates((await analyticsApi.getCustomerCandidates(q, 80)) ?? []);
    } catch (e) {
      toast.error(`Ошибка загрузки заказчиков из истории: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCandidatesLoading(false);
    }
  };

  useEffect(() => { loadCandidates(""); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) { setFormError("Введите имя заказчика"); return; }
    setAdding(true); setFormError(null);
    try {
      await analyticsApi.addCustomer({ customer_name: formName.trim(), customer_id: formCustomerId, notify_email: formEmail, notes: formNotes });
      pushNotification("success", "Заказчик отслеживается", `«${formName.trim()}» добавлен в избранные заказчики.`, "/analytics/customers", "mentions");
      setFormName(""); setFormCustomerId(""); setFormEmail(""); setFormNotes("");
      setShowAdd(false);
      await Promise.all([load(), loadCandidates("")]);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await analyticsApi.deleteCustomer(deleteTarget.id);
      setCustomers((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) { setSelectedId(null); setCustomerLots(null); }
      toast.success(`«${deleteTarget.customer_name}» удалён из отслеживаемых`);
    } catch (e) {
      toast.error(`Ошибка удаления: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleteTarget(null);
    }
  };

  const addCandidate = async (candidate: CustomerCandidate) => {
    setAdding(true);
    try {
      await analyticsApi.addCustomer({
        customer_name: candidate.customer_name,
        customer_id: candidate.customer_id,
        notes: `Добавлен из истории закупок: ${candidate.tender_count} тендер(ов)`,
      });
      pushNotification("success", "Заказчик добавлен", `«${candidate.customer_name}» добавлен в избранные.`, "/analytics/customers", "mentions");
      await Promise.all([load(), loadCandidates(candidateQuery)]);
    } catch (e) {
      toast.error(`Не удалось добавить: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  };

  const toggleFavorite = async (customer: TrackedCustomer) => {
    try {
      const updated = await analyticsApi.updateCustomer(customer.id, {
        customer_name: customer.customer_name,
        customer_id: customer.customer_id,
        notify_email: customer.notify_email,
        notes: customer.notes,
        is_favorite: !customer.is_favorite,
      });
      setCustomers((prev) => prev.map((c) => c.id === customer.id ? { ...c, is_favorite: updated.is_favorite } : c));
    } catch (e) {
      toast.error(`Не удалось обновить избранное: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSelect = async (id: number) => {
    if (selectedId === id) { setSelectedId(null); setCustomerLots(null); return; }
    setSelectedId(id); setLotsLoading(true);
    try {
      const cl = await analyticsApi.getCustomerLots(id);
      setCustomerLots({ customer: cl.customer, lots: cl.lots ?? [] });
    } catch (e) { console.error(e); }
    finally { setLotsLoading(false); }
  };

  return (
    <>
      <PageHeader
        title="Трекинг заказчиков"
        description="Мониторинг закупочной активности заказчиков"
        actions={
          <button onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Добавить заказчика
          </button>
        }
      />

      <div className="space-y-6 p-8">
        {/* Форма добавления */}
        {showAdd && (
          <div className="rounded-xl border border-border bg-card p-6 animate-in slide-in-from-top-2" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Новый заказчик</h3>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Наименование заказчика *</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} required
                  placeholder="Например: АО «Казтелеком»"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">БИН / ИИН</label>
                <input value={formCustomerId} onChange={(e) => setFormCustomerId(e.target.value)}
                  placeholder="123456789012"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Email для уведомлений</label>
                <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="email@company.kz"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Заметки</label>
                <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Приоритетный заказчик и т.д."
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              {formError && <p className="sm:col-span-2 text-sm text-destructive">{formError}</p>}
              <div className="sm:col-span-2 flex gap-2">
                <button type="submit" disabled={adding}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {adding ? "Сохранение…" : "Добавить"}
                </button>
                <button type="button" onClick={() => setShowAdd(false)}
                  className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
                  Отмена
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Выбрать заказчика из истории</h3>
              <p className="text-xs text-muted-foreground">Список формируется из исторических закупок после синхронизации.</p>
            </div>
            <button onClick={() => loadCandidates(candidateQuery)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-accent">
              <RefreshCw className={`h-4 w-4 ${candidatesLoading ? "animate-spin" : ""}`} /> Обновить
            </button>
          </div>
          <div className="mb-3 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                value={candidateQuery}
                onChange={(e) => setCandidateQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") loadCandidates(candidateQuery); }}
                placeholder="Поиск по названию заказчика"
                className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <button onClick={() => loadCandidates(candidateQuery)} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Найти</button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {candidates.slice(0, 12).map((c) => (
              <div key={`${c.customer_name}-${c.customer_id}`} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.customer_name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.tender_count} тенд. · ₸ {fmtM(c.total_budget)}</p>
                  </div>
                  <button
                    disabled={adding || c.is_tracked}
                    onClick={() => addCandidate(c)}
                    className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${c.is_tracked ? "bg-green-100 text-green-700" : "bg-primary text-primary-foreground hover:opacity-90"}`}
                  >
                    {c.is_tracked ? "Добавлен" : "В избранные"}
                  </button>
                </div>
              </div>
            ))}
            {!candidatesLoading && candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">Нет кандидатов. Сначала синхронизируйте историю тендеров.</p>
            )}
          </div>
        </div>

        {/* Список заказчиков */}
        <div className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="border-b border-border px-6 py-4">
            <h3 className="text-sm font-semibold">Отслеживаемые заказчики</h3>
            <p className="text-xs text-muted-foreground">{customers.length} заказчик(ов)</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" /> Загрузка…
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Building2 className="mb-3 h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">Нет отслеживаемых заказчиков</p>
              <p className="mt-1 text-xs">Нажмите «Добавить заказчика» для начала мониторинга</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {[...customers].sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0)).map((c) => (
                <div key={c.id}>
                  <div className={`flex items-center gap-4 px-6 py-4 transition hover:bg-muted/30 ${selectedId === c.id ? "bg-muted/40" : ""} ${c.is_favorite ? "border-l-2 border-l-yellow-400 pl-5" : ""}`}>
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold text-sm ${c.is_favorite ? "bg-yellow-100 text-yellow-700" : "bg-primary/10 text-primary"}`}>
                      {c.customer_name[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{c.customer_name}</p>
                      <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {c.tender_count > 0 && <span className="flex items-center gap-1"><Hash className="h-3 w-3" />{c.tender_count} тенд.</span>}
                        {c.total_budget > 0 && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />₸ {fmtM(c.total_budget)}</span>}
                        {c.last_tender_at && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />посл. {fmtDate(c.last_tender_at)}</span>}
                        {c.notify_email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.notify_email}</span>}
                      </div>
                      {c.notes && <p className="mt-0.5 text-xs text-muted-foreground/70 truncate">{c.notes}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => toggleFavorite(c)}
                        title={c.is_favorite ? "Убрать из избранного" : "Добавить в избранное"}
                        className={`rounded-lg p-1.5 transition ${c.is_favorite ? "text-yellow-500 hover:bg-yellow-100" : "text-muted-foreground hover:bg-accent"}`}>
                        <Star className={`h-4 w-4 ${c.is_favorite ? "fill-current" : ""}`} />
                      </button>
                      <button onClick={() => handleSelect(c.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${selectedId === c.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-accent"}`}>
                        <History className="h-3.5 w-3.5" /> История
                      </button>
                      <button onClick={() => setDeleteTarget(c)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* История закупок заказчика */}
                  {selectedId === c.id && (
                    <div className="border-t border-border bg-muted/20 px-6 py-4">
                      {lotsLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" /> Загрузка истории…
                        </div>
                      ) : customerLots && customerLots.lots.length > 0 ? (
                        <div className="overflow-x-auto">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            История закупок — {customerLots.lots.length} тендер(ов)
                          </p>
                          <table className="w-full min-w-[700px] text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="pb-2 font-medium">ID</th>
                                <th className="pb-2 font-medium">Наименование</th>
                                <th className="pb-2 font-medium">Вид закупки</th>
                                <th className="pb-2 text-right font-medium">Нач. цена</th>
                                <th className="pb-2 font-medium">Дата</th>
                                <th className="pb-2 font-medium">Победитель</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {customerLots.lots.slice(0, 20).map((lot) => (
                                <tr key={lot.id} className="hover:bg-muted/30">
                                  <td className="py-2 font-mono text-muted-foreground">{lot.lot_id}</td>
                                  <td className="py-2 max-w-[280px] truncate font-medium">{lot.title}</td>
                                  <td className="py-2 text-muted-foreground">{lot.purchase_type || "—"}</td>
                                  <td className="py-2 text-right tabular-nums font-semibold">{fmtN(lot.initial_amount)}</td>
                                  <td className="py-2 text-muted-foreground">{fmtDate(lot.end_date)}</td>
                                  <td className="py-2 text-muted-foreground truncate max-w-[120px]">{lot.winner_name || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {customerLots.lots.length > 20 && (
                            <p className="mt-2 text-xs text-muted-foreground">… и ещё {customerLots.lots.length - 20} тендер(ов)</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Нет данных. Синхронизируйте тендеры на странице «История тендеров».
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить заказчика?"
        description={deleteTarget ? `«${deleteTarget.customer_name}» будет удалён из списка отслеживаемых.` : undefined}
        confirmLabel="Удалить"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismiss} />
    </>
  );
}
