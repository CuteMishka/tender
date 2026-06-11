import { useMemo, useRef, useState } from "react";
import { Bot, CheckCheck, Cloud, FileText, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  askCloudy,
  fetchDocumentBlobViaBackendProxy,
  indexLotDocument,
  isCloudySupportedDocument,
  tenderDocumentBlobToFile,
  type CloudyCitation,
  type TenderDocument,
} from "@/lib/tenders-api";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: CloudyCitation[];
};

type CloudyChatProps = {
  lotId: string;
  documents: TenderDocument[];
};

const suggestions = [
  "Какой срок выполнения работ?",
  "Какая сумма и условия оплаты?",
  "Какие основные технические требования?",
  "Какие документы нужно предоставить?",
];

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sourceHint(document: TenderDocument): string {
  return `cloudy:${stableHash(document.downloadLink)}:${document.name || "document"}`;
}

export function CloudyChat({ lotId, documents }: CloudyChatProps) {
  const supported = useMemo(() => documents.filter(isCloudySupportedDocument), [documents]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(supported.map(sourceHint)));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const indexedSources = useRef(new Set<string>());
  const session = useRef(0);

  const selectedDocuments = supported.filter((document) => selected.has(sourceHint(document)));

  function resetConversation() {
    setMessages([]);
    setQuestion("");
    setProgress(null);
    setError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setSelected(new Set(supported.map(sourceHint)));
    } else {
      session.current += 1;
      setBusy(false);
      resetConversation();
    }
  }

  function toggleDocument(document: TenderDocument) {
    const hint = sourceHint(document);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(hint)) next.delete(hint);
      else next.add(hint);
      return next;
    });
  }

  async function ensureIndexed(activeSession: number) {
    for (let index = 0; index < selectedDocuments.length; index++) {
      if (session.current !== activeSession) return;
      const document = selectedDocuments[index];
      const hint = sourceHint(document);
      if (indexedSources.current.has(hint)) continue;
      setProgress(`Читаю документ ${index + 1} из ${selectedDocuments.length}: ${document.name}`);
      const blob = await fetchDocumentBlobViaBackendProxy(document.downloadLink, { timeoutMs: 60_000 });
      if (session.current !== activeSession) return;
      const file = tenderDocumentBlobToFile(document, blob);
      await indexLotDocument(lotId, file, {
        sourceHint: hint,
        extractSpecPoints: false,
        includeExtractedText: false,
      });
      if (session.current !== activeSession) return;
      indexedSources.current.add(hint);
    }
  }

  async function sendQuestion(rawQuestion?: string) {
    const text = (rawQuestion ?? question).trim();
    if (!text || busy || selectedDocuments.length === 0) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const activeSession = session.current;
    const previousMessages = messages;
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setBusy(true);
    setError(null);
    try {
      await ensureIndexed(activeSession);
      if (session.current !== activeSession) return;
      setProgress("Cloudy ищет ответ в выбранных документах…");
      const response = await askCloudy({
        lotId,
        question: text,
        sourceHints: selectedDocuments.map(sourceHint),
        history: previousMessages.map(({ role, content }) => ({ role, content })),
      });
      if (session.current !== activeSession) return;
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: response.answer, citations: response.citations },
      ]);
    } catch (reason: unknown) {
      if (session.current === activeSession) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (session.current === activeSession) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-2xl bg-emerald-600 px-4 py-3 text-white shadow-xl transition-all duration-300 hover:-translate-y-1 hover:bg-emerald-500 hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2"
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
          <Cloud className="h-6 w-6" />
        </span>
        <span className="text-left">
          <span className="block text-sm font-bold">Cloudy</span>
          <span className="block text-[11px] text-emerald-50">Спросить по документам</span>
        </span>
      </button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border bg-gradient-to-r from-emerald-700 to-emerald-500 px-6 py-5 text-left text-white">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 shadow-inner">
                <Cloud className="h-7 w-7" />
              </span>
              <div>
                <SheetTitle className="text-xl text-white">Cloudy</SheetTitle>
                <SheetDescription className="text-emerald-50">
                  Помощник по технической спецификации лота
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="border-b border-border bg-muted/20 px-6 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Документы для ответа</p>
                <p className="text-xs text-muted-foreground">Cloudy не использует файлы без отметки</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(new Set(selected.size === supported.length ? [] : supported.map(sourceHint)))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {selected.size === supported.length ? "Снять все" : "Выбрать все"}
              </button>
            </div>
            <ScrollArea className="max-h-32">
              <div className="grid gap-2 pr-3">
                {supported.map((document) => {
                  const hint = sourceHint(document);
                  return (
                    <label key={hint} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-3 py-2.5 hover:border-emerald-300">
                      <Checkbox checked={selected.has(hint)} onCheckedChange={() => toggleDocument(document)} />
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="min-w-0 truncate text-xs font-medium">{document.name || "Документ"}</span>
                    </label>
                  );
                })}
                {supported.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    У лота нет документов поддерживаемого формата.
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>

          <ScrollArea className="min-h-0 flex-1 bg-background">
            <div className="space-y-4 px-6 py-5">
              {messages.length === 0 && (
                <div className="animate-in fade-in-0 slide-in-from-bottom-3 duration-500">
                  <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-950">
                    <div className="mb-2 flex items-center gap-2 font-semibold">
                      <Sparkles className="h-4 w-4" /> Я прочитаю выбранные документы
                    </div>
                    Спросите о сроках, бюджете, требованиях, документах или условиях поставки. Если ответа в файлах нет, я так и скажу.
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {suggestions.map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => void sendQuestion(suggestion)} disabled={busy || selected.size === 0} className="rounded-xl border border-border p-3 text-left text-xs font-medium transition-colors hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50">
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <div key={message.id} className={`flex animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${message.role === "user" ? "rounded-br-md bg-emerald-600 text-white" : "rounded-bl-md border border-border bg-muted/35 text-foreground"}`}>
                    {message.role === "assistant" && (
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-700">
                        <Bot className="h-4 w-4" /> Cloudy
                      </div>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    {message.citations && message.citations.length > 0 && (
                      <div className="mt-3 border-t border-border/70 pt-2">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Источники</p>
                        <div className="flex flex-wrap gap-1.5">
                          {message.citations.map((citation) => (
                            <span key={`${citation.source_hint}-${citation.number}`} title={citation.excerpt} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] text-emerald-800">
                              [{citation.number}] {citation.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="flex justify-start animate-in fade-in-0 duration-300">
                  <div className="flex max-w-[88%] items-center gap-3 rounded-2xl rounded-bl-md border border-border bg-muted/35 px-4 py-3 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                    <span>{progress || "Cloudy думает…"}</span>
                  </div>
                </div>
              )}
              {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            </div>
          </ScrollArea>

          <div className="border-t border-border bg-background px-5 py-4">
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Диалог удалится при закрытии окна</span>
              {messages.length > 0 && (
                <button type="button" onClick={resetConversation} disabled={busy} className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50">
                  <Trash2 className="h-3 w-3" /> Очистить
                </button>
              )}
            </div>
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-muted/20 p-2 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
                placeholder="Например: какой срок поставки?"
                className="min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                disabled={busy || selected.size === 0}
              />
              <button type="button" onClick={() => void sendQuestion()} disabled={busy || !question.trim() || selected.size === 0} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
