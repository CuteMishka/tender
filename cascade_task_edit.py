from pathlib import Path

root = Path(__file__).resolve().parent

handlers = root / "tenderai" / "internal" / "analytics" / "handlers.go"
s = handlers.read_text(encoding="utf-8-sig")
if "func (h *Handler) DeleteLot" not in s:
    s += '''

// DELETE /api/v1/analytics/lots/{id}
func (h *Handler) DeleteLot(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.DB.Model(&HistoricalLot{}).Where("id = ?", id).Update("excluded_from_analytics", true).Error; err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}
'''
handlers.write_text(s, encoding="utf-8")

main = root / "tenderai" / "cmd" / "api" / "main.go"
s = main.read_text(encoding="utf-8-sig")
if 's.Delete("/lots/{id}"' not in s:
    s = s.replace('s.Put("/lots/{id}", ah.UpdateLot)', 's.Put("/lots/{id}", ah.UpdateLot)\n\t\t\ts.Delete("/lots/{id}", ah.DeleteLot)')
main.write_text(s, encoding="utf-8")

analytics_api = root / "tenderflow-admin" / "src" / "lib" / "analytics-api.ts"
s = analytics_api.read_text(encoding="utf-8-sig")
s = s.replace("  lot_source: string;\n", "  lot_source: string;\n  excluded_from_analytics: boolean;\n")
s = s.replace("  with_contract: number;\n", "  with_contract: number;\n  excluded_lots: number;\n")
s = s.replace('  participation?: "our";\n', '  participation?: "our";\n  excluded?: "include" | "only";\n')
s = s.replace("async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {", "async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {")
s = s.replace("      participation: filters.participation,\n", "      participation: filters.participation,\n      excluded: filters.excluded,\n")
s = s.replace("  updateLot: (id: number, data: { winner_name?: string; winner_id?: string; contract_amount?: number; status?: string; region?: string }) =>\n    put<{ success: boolean }>(`/api/v1/analytics/lots/${id}`, data),", "  updateLot: (id: number, data: { winner_name?: string; winner_id?: string; contract_amount?: number; status?: string; region?: string; excluded_from_analytics?: boolean }) =>\n    put<{ success: boolean }>(`/api/v1/analytics/lots/${id}`, data),\n\n  excludeLot: (id: number) => del<{ success: boolean }>(`/api/v1/analytics/lots/${id}`),\n\n  restoreLot: (id: number) => put<{ success: boolean }>(`/api/v1/analytics/lots/${id}`, { excluded_from_analytics: false }),")
analytics_api.write_text(s, encoding="utf-8")

historical = root / "tenderflow-admin" / "src" / "routes" / "_admin" / "analytics.historical.tsx"
s = historical.read_text(encoding="utf-8-sig")
s = s.replace("  DollarSign, Hash, BarChart2, Percent, Pencil, X, Check, Building2, Star,\n", "  DollarSign, Hash, BarChart2, Percent, Pencil, X, Check, Building2, Star, Trash2, RotateCcw, EyeOff,\n")
s = s.replace("  const [onlyOurParticipation, setOnlyOurParticipation] = useState(false);\n", "  const [onlyOurParticipation, setOnlyOurParticipation] = useState(false);\n  const [excludedMode, setExcludedMode] = useState<\"active\" | \"only\">(\"active\");\n")
s = s.replace("          participation: onlyOurParticipation ? \"our\" : undefined,\n", "          participation: onlyOurParticipation ? \"our\" : undefined,\n          excluded: excludedMode === \"only\" ? \"only\" : undefined,\n")
s = s.replace("  }, [page, filterCustomer, filterType, filterRegion, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax, onlyOurParticipation]);", "  }, [page, filterCustomer, filterType, filterRegion, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax, onlyOurParticipation, excludedMode]);")
s = s.replace("    setFilterDateFrom(\"\"); setFilterDateTo(\"\"); setFilterAmountMin(\"\"); setFilterAmountMax(\"\"); setOnlyOurParticipation(false);\n", "    setFilterDateFrom(\"\"); setFilterDateTo(\"\"); setFilterAmountMin(\"\"); setFilterAmountMax(\"\"); setOnlyOurParticipation(false); setExcludedMode(\"active\");\n")
insert_after = '''  const handleTrackCustomer = async (lot: HistoricalLot) => {
    const name = lotCustomerName(lot);
    if (!name) return;
    try {
      await analyticsApi.addCustomer({
        customer_name: name,
        customer_id: lot.customer_id,
        notes: `Добавлен из истории тендеров: ${lot.title}`,
      });
      setTrackedCustomerNames((prev) => new Set(prev).add(name.toLowerCase()));
      toast.success(`«${name}» добавлен в отслеживаемые заказчики`);
    } catch (e) {
      toast.error(`Не удалось добавить заказчика: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
'''
replacement = insert_after + '''
  const handleToggleExcluded = async (lot: HistoricalLot) => {
    try {
      if (lot.excluded_from_analytics) {
        await analyticsApi.restoreLot(lot.id);
        toast.success("Лот возвращён в аналитику");
      } else {
        await analyticsApi.excludeLot(lot.id);
        toast.success("Лот исключён из перерасчёта аналитики");
      }
      await loadAll();
    } catch (e) {
      toast.error(`Не удалось изменить лот: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
'''
if "const handleToggleExcluded" not in s:
    s = s.replace(insert_after, replacement)
s = s.replace("                Только с нашим участием\n              </label>\n", "                Только с нашим участием\n              </label>\n              <label className=\"inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm\">\n                <input\n                  type=\"checkbox\"\n                  checked={excludedMode === \"only\"}\n                  onChange={(e) => { setExcludedMode(e.target.checked ? \"only\" : \"active\"); setPage(1); }}\n                  className=\"rounded\"\n                />\n                Показать исключённые\n              </label>\n")
s = s.replace("          <StatCard label=\"С победителем\" value={stats ? String(stats.with_winner) : \"—\"}\n            sub={stats ? `из ${stats.total_lots}` : undefined}\n            icon={TrendingUp} accent=\"bg-violet-100 text-violet-600\" />", "          <StatCard label=\"С победителем\" value={stats ? String(stats.with_winner) : \"—\"}\n            sub={stats ? `Исключено: ${stats.excluded_lots ?? 0}` : undefined}\n            icon={TrendingUp} accent=\"bg-violet-100 text-violet-600\" />")
s = s.replace("                      <th className=\"px-4 py-3 w-10\" />", "                      <th className=\"px-4 py-3 text-right font-medium\">Действия</th>")
s = s.replace("                    <tr key={lot.id} className=\"border-t border-border hover:bg-muted/30 transition-colors\">", "                    <tr key={lot.id} className={`border-t border-border transition-colors ${lot.excluded_from_analytics ? \"bg-muted/40 opacity-70\" : \"hover:bg-muted/30\"}`}>")
s = s.replace("                        <div className=\"max-w-xs truncate font-medium text-foreground\">{lot.title}</div>\n                        {lot.purchase_type && <div className=\"text-[11px] text-muted-foreground\">{lot.purchase_type}</div>}", "                        <div className=\"max-w-xs truncate font-medium text-foreground\">{lot.title}</div>\n                        <div className=\"mt-1 flex flex-wrap gap-1\">\n                          {lot.purchase_type && <span className=\"text-[11px] text-muted-foreground\">{lot.purchase_type}</span>}\n                          {lot.excluded_from_analytics && (\n                            <span className=\"inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground\">\n                              <EyeOff className=\"h-3 w-3\" /> исключён из расчёта\n                            </span>\n                          )}\n                        </div>")
s = s.replace("                      <td className=\"px-4 py-3\">\n                        <button\n                          onClick={() => openEdit(lot)}\n                          title=\"Внести результат\"\n                          className=\"rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors\"\n                        >\n                          <Pencil className=\"h-3.5 w-3.5\" />\n                        </button\n                      </td>", "                      <td className=\"px-4 py-3\">\n                        <div className=\"flex justify-end gap-1\">\n                          <button\n                            onClick={() => openEdit(lot)}\n                            title=\"Внести результат\"\n                            className=\"rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors\"\n                          >\n                            <Pencil className=\"h-3.5 w-3.5\" />\n                          </button>\n                          <button\n                            onClick={() => handleToggleExcluded(lot)}\n                            title={lot.excluded_from_analytics ? \"Вернуть в аналитику\" : \"Исключить из перерасчёта\"}\n                            className=\"rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors\"\n                          >\n                            {lot.excluded_from_analytics ? <RotateCcw className=\"h-3.5 w-3.5\" /> : <Trash2 className=\"h-3.5 w-3.5\" />}\n                          </button>\n                        </div>\n                      </td>")
historical.write_text(s, encoding="utf-8")
