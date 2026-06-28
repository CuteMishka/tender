import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  FileText,
  MessageCircle,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  askTenderAssistant,
  type TenderChatHistoryMessage,
  type TenderChatSource,
  type TenderDocument,
} from "@/lib/tenders-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

/* ─────────────────────────── Types ─────────────────────────── */

type TenderAssistantMessage = TenderChatHistoryMessage & {
  id: string;
  sources?: TenderChatSource[];
  followUp?: string[];
  warnings?: string[];
  error?: boolean;
  provider?: string;
  model?: string;
};

type TenderAssistantChatProps = {
  tenderId: number;
  tenderTitle?: string;
  documents?: TenderDocument[];
  requiredServices?: string[];
};

/* ─────────────────────────── Constants ─────────────────────── */

const quickQuestions = [
  "Какая сумма и валюта закупки?",
  "Какие ключевые требования по ТС?",
  "Какие документы или сертификаты нужно проверить?",
  "Какой срок подачи заявки?",
];

const loadingTexts = [
  "Tender думает…",
  "Анализирую документы…",
  "Ищу ответ…",
];

/* ─────────────────────────── Helpers ───────────────────────── */

function messageId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function cleanDocName(doc: TenderDocument, index: number): string {
  return (doc.name || "").replace(/\s+/g, " ").trim() || "Документ " + (index + 1);
}

function defaultRange(docCount: number): [number, number] {
  if (docCount <= 0) return [0, 0];
  return [1, Math.min(docCount, 12)];
}

function inferServiceTags(title: string | undefined, documents: TenderDocument[], requiredServices: string[] | undefined): string[] {
  const raw = [
    ...(requiredServices ?? []),
    title ?? "",
    ...documents.map((doc) => doc.name ?? ""),
  ].join(" ").toLowerCase();
  const tags: string[] = [];
  const add = (tag: string, patterns: string[]) => {
    if (patterns.some((pattern) => raw.includes(pattern)) && !tags.includes(tag)) {
      tags.push(tag);
    }
  };
  add("IaaS", ["iaas", "инфраструктур", "облачн", "виртуальн"]);
  add("Colocation", ["colocation", "colo", "колокац", "стойко", "стойк", "цод", "дата-центр"]);
  add("GPU", ["gpu", "gpgpu", "графическ", "видеокарт", "ускорител"]);
  add("VPS/VDS", ["vps", "vds", "виртуального выделенного сервера", "виртуальный выделенный сервер"]);
  add("Dedicated", ["dedicated", "bare metal", "физическ"]);
  for (const service of requiredServices ?? []) {
    const clean = service.replace(/\s+/g, " ").trim();
    if (clean && !tags.some((tag) => tag.toLowerCase() === clean.toLowerCase())) {
      tags.push(clean);
    }
    if (tags.length >= 5) break;
  }
  return tags.slice(0, 5);
}

/* ───────────────────── Markdown Renderer ──────────────────── */

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;
  let key = 0;

  function flushList() {
    if (listItems.length > 0 && listType) {
      const Tag = listType;
      elements.push(
        <Tag
          key={"list-" + key++}
          className={cn(
            "my-1.5 space-y-0.5 pl-5",
            listType === "ul" ? "list-disc" : "list-decimal",
          )}
        >
          {listItems}
        </Tag>,
      );
      listItems = [];
      listType = null;
    }
  }

  function inlineFormat(raw: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    // regex: **bold**, *italic*, `code`
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(raw)) !== null) {
      if (match.index > lastIndex) {
        parts.push(raw.slice(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(
          <strong key={"b-" + match.index} className="font-semibold">
            {match[2]}
          </strong>,
        );
      } else if (match[3]) {
        parts.push(
          <em key={"i-" + match.index} className="italic">
            {match[3]}
          </em>,
        );
      } else if (match[4]) {
        parts.push(
          <code
            key={"c-" + match.index}
            className="rounded bg-emerald-100/60 px-1 py-0.5 text-[0.85em] font-mono text-emerald-800"
          >
            {match[4]}
          </code>,
        );
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < raw.length) {
      parts.push(raw.slice(lastIndex));
    }
    return parts.length > 0 ? parts : raw;
  }

  for (const line of lines) {
    const trimmed = line.trimStart();

    // Unordered list
    const ulMatch = /^[-•]\s+(.+)/.exec(trimmed);
    if (ulMatch) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(<li key={"li-" + key++}>{inlineFormat(ulMatch[1])}</li>);
      continue;
    }

    // Ordered list
    const olMatch = /^\d+[.)]\s+(.+)/.exec(trimmed);
    if (olMatch) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(<li key={"li-" + key++}>{inlineFormat(olMatch[1])}</li>);
      continue;
    }

    flushList();

    if (trimmed === "") {
      elements.push(<br key={"br-" + key++} />);
    } else {
      elements.push(
        <p key={"p-" + key++} className="my-0.5">
          {inlineFormat(trimmed)}
        </p>,
      );
    }
  }
  flushList();
  return elements;
}

/* ───────────────────── Subcomponents ──────────────────────── */

function TenderAvatar({
  className,
  iconClassName,
  glow,
}: {
  className?: string;
  iconClassName?: string;
  glow?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm",
        className,
      )}
    >
      {glow && (
        <span className="absolute inset-0 rounded-xl animate-[tender-breathe_3s_ease-in-out_infinite] border-2 border-emerald-400/40" />
      )}
      <Sparkles className={cn("h-4 w-4", iconClassName)} />
    </span>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
          style={{
            animation: "tender-dot-bounce 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}

function CollapsibleSources({ sources }: { sources: TenderChatSource[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
      >
        <FileText className="h-3 w-3" />
        {expanded ? "Скрыть" : "Показать"} источники ({sources.length})
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          expanded ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden space-y-2">
          {sources.slice(0, 5).map((source, index) => (
            <div
              key={source.document + "-" + index}
              className="rounded-xl border border-border bg-gradient-to-r from-white to-emerald-50/30 px-3 py-2.5 text-xs text-muted-foreground transition hover:shadow-sm hover:border-emerald-200"
            >
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
                <FileText className="h-3.5 w-3.5 text-emerald-500" />
                {source.document}
              </div>
              <p className="line-clamp-3 leading-relaxed">{source.snippet}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Global CSS (injected once) ───────────── */

const STYLE_ID = "tender-chat-animations";
function useInjectStyles() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes tender-pulse-ring {
        0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.35); }
        50% { box-shadow: 0 0 0 10px rgba(16,185,129,0); }
      }
      @keyframes tender-breathe {
        0%, 100% { opacity: 0.4; transform: scale(1); }
        50% { opacity: 0.8; transform: scale(1.05); }
      }
      @keyframes tender-dot-bounce {
        0%, 80%, 100% { transform: translateY(0); }
        40% { transform: translateY(-5px); }
      }
      @keyframes tender-message-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes tender-stagger-in {
        from { opacity: 0; transform: translateY(6px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes tender-shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      @keyframes tender-send-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.3); }
        50% { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
      }
      .tender-msg-in {
        animation: tender-message-in 0.3s ease-out both;
      }
      .tender-stagger-in {
        animation: tender-stagger-in 0.35s ease-out both;
      }
      .tender-shimmer-bg {
        background: linear-gradient(90deg, transparent 25%, rgba(16,185,129,0.06) 50%, transparent 75%);
        background-size: 200% 100%;
        animation: tender-shimmer 2s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);
}

/* ─────────────────────── Main Component ───────────────────── */

export function TenderAssistantChat({ tenderId, tenderTitle, documents = [], requiredServices = [] }: TenderAssistantChatProps) {
  useInjectStyles();

  const docCount = documents.length;
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[number, number]>(() => defaultRange(docCount));
  const [messages, setMessages] = useState<TenderAssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTextIdx, setLoadingTextIdx] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef(0);

  /* ── Reset on tender / doc changes ── */
  useEffect(() => {
    setRange(defaultRange(docCount));
    setMessages([]);
    setInput("");
    setError(null);
    setLoading(false);
    sessionRef.current += 1;
  }, [docCount, tenderId]);

  /* ── Auto-scroll ── */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  /* ── Cycle loading text ── */
  useEffect(() => {
    if (!loading) {
      setLoadingTextIdx(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingTextIdx((prev) => (prev + 1) % loadingTexts.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [loading]);

  /* ── Selected documents ── */
  const selectedDocuments = useMemo(() => {
    if (docCount <= 0 || range[0] <= 0 || range[1] <= 0) return [];
    return documents.slice(range[0] - 1, range[1]);
  }, [docCount, documents, range]);

  const selectedCount = selectedDocuments.length;
  const tooManyDocuments = selectedCount > 12;
  const serviceTags = useMemo(
    () => inferServiceTags(tenderTitle, documents, requiredServices),
    [tenderTitle, documents, requiredServices],
  );
  const serviceQuestion = serviceTags.length > 0
    ? `Определи по ТС, какая это услуга: ${serviceTags.join(", ")} или другой тип. Дай короткий вывод и признаки из документов.`
    : "Определи по ТС, какая это услуга: IaaS, Colocation, GPU или другой тип. Дай короткий вывод и признаки из документов.";
  const quickQuestionItems = useMemo(() => [serviceQuestion, ...quickQuestions], [serviceQuestion]);

  /* ── Session management ── */
  function resetSession() {
    sessionRef.current += 1;
    setRange(defaultRange(docCount));
    setMessages([]);
    setInput("");
    setError(null);
    setLoading(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) resetSession();
  }

  /* ── Range selectors ── */
  function updateFrom(value: number) {
    setRange((current) => {
      const nextFrom = Math.max(1, Math.min(value, docCount));
      return [nextFrom, Math.max(nextFrom, current[1])];
    });
  }

  function updateTo(value: number) {
    setRange((current) => {
      const nextTo = Math.max(1, Math.min(value, docCount));
      return [Math.min(current[0], nextTo), nextTo];
    });
  }

  /* ── Send question ── */
  const sendQuestion = useCallback(
    async (explicitQuestion?: string) => {
      const question = (explicitQuestion ?? input).trim();
      if (!question || loading || tooManyDocuments) return;

      const sessionId = sessionRef.current;
      const history = messages
        .filter((message) => !message.error)
        .map((message) => ({ role: message.role, content: message.content }));

      const userMessage: TenderAssistantMessage = {
        id: messageId(),
        role: "user",
        content: question,
      };

      setMessages((current) => [...current, userMessage]);
      setInput("");
      setError(null);
      setLoading(true);

      try {
        const response = await askTenderAssistant(
          tenderId,
          {
            question,
            history,
            documentRange: docCount > 0 ? { from: range[0], to: range[1] } : undefined,
          },
          { timeoutMs: 180_000 },
        );
        if (sessionRef.current !== sessionId) return;
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            content: response.answer,
            sources: response.sources ?? [],
            followUp: response.followUp ?? [],
            warnings: response.warnings ?? [],
            provider: response.provider,
            model: response.model,
          },
        ]);
      } catch (e: unknown) {
        if (sessionRef.current !== sessionId) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            content: message,
            error: true,
          },
        ]);
      } finally {
        if (sessionRef.current === sessionId) setLoading(false);
      }
    },
    [input, loading, tooManyDocuments, messages, tenderId, docCount, range],
  );

  const hasInput = input.trim().length > 0;

  /* ─────────────────────────── Render ─────────────────────── */
  return (
    <>
      {/* ── Floating Button ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 py-3 pl-4 pr-6 text-sm font-semibold text-white shadow-xl shadow-emerald-500/25 backdrop-blur-md transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2"
        style={{ animation: "tender-pulse-ring 3s ease-in-out infinite" }}
      >
        <TenderAvatar className="h-9 w-9 border border-white/20" />
        <span>Tender</span>
      </button>

      {/* ── Sheet ── */}
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[44rem]">
          {/* ── Header ── */}
          <SheetHeader className="border-b border-border bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-6 py-5 text-left">
            <div className="flex items-start gap-3 pr-8">
              <TenderAvatar
                className="h-12 w-12 border border-emerald-200"
                iconClassName="h-5 w-5"
                glow
              />
              <div className="min-w-0 flex-1">
                <SheetTitle className="flex items-center gap-2">
                  Tender
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                    <Sparkles className="h-3 w-3 text-emerald-500" />
                    LLM по ТС
                  </span>
                </SheetTitle>
                <SheetDescription className="mt-1">
                  Задавайте вопросы по выбранному диапазону документов лота. Диалог очищается при
                  закрытии окна.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* ── Document Range ── */}
          <div className="border-b border-border px-6 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">Диапазон документов</p>
                <p className="text-xs text-muted-foreground">
                  {docCount > 0
                    ? "Выбрано " + selectedCount + " из " + docCount + " документов"
                    : "Документы не найдены, Tender ответит по карточке лота"}
                </p>
              </div>
              {messages.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetSession}
                  disabled={loading}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Очистить
                </Button>
              )}
            </div>

            {docCount > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  С документа
                  <select
                    value={range[0]}
                    onChange={(event) => updateFrom(Number(event.target.value))}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    disabled={loading}
                  >
                    {documents.map((doc, index) => (
                      <option key={"from-" + doc.downloadLink + "-" + index} value={index + 1}>
                        {index + 1}. {cleanDocName(doc, index)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  По документ
                  <select
                    value={range[1]}
                    onChange={(event) => updateTo(Number(event.target.value))}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    disabled={loading}
                  >
                    {documents.map((doc, index) => (
                      <option key={"to-" + doc.downloadLink + "-" + index} value={index + 1}>
                        {index + 1}. {cleanDocName(doc, index)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {selectedDocuments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedDocuments.slice(0, 4).map((doc, index) => (
                  <span
                    key={doc.downloadLink + "-selected-" + index}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
                    title={cleanDocName(doc, index)}
                  >
                    <FileText className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="max-w-[12rem] truncate">{cleanDocName(doc, index)}</span>
                  </span>
                ))}
                {selectedDocuments.length > 4 && (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                    ещё {selectedDocuments.length - 4}
                  </span>
                )}
              </div>
            )}

            {tooManyDocuments && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Для скорости выберите не больше 12 документов за один вопрос.
              </p>
            )}
          </div>

          {/* ── Messages Area ── */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {messages.length === 0 ? (
              /* ── Empty State ── */
              <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/60 p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20">
                    <MessageCircle className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">Спросите Tender по ТС</p>
                    <p className="text-sm text-muted-foreground">
                      Например: сроки, бюджет, обязательные требования, поставка, лицензии.
                    </p>
                  </div>
                </div>
                {serviceTags.length > 0 && (
                  <div className="mb-4 rounded-xl border border-emerald-200 bg-white/70 px-4 py-3">
                    <p className="text-xs font-medium uppercase text-emerald-700">Предполагаемая услуга</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {serviceTags.map((tag) => (
                        <span key={tag} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {quickQuestionItems.map((question, qi) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => void sendQuestion(question)}
                      disabled={loading || tooManyDocuments}
                      className="tender-stagger-in rounded-full border border-emerald-200 bg-white px-3.5 py-2 text-xs font-medium text-foreground shadow-sm transition-all hover:scale-[1.04] hover:border-emerald-300 hover:shadow-md hover:shadow-emerald-100 disabled:opacity-50"
                      style={{ animationDelay: `${qi * 80}ms` }}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* ── Message List ── */
              <div className="space-y-5">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "tender-msg-in flex gap-3",
                        isUser ? "justify-end" : "justify-start",
                      )}
                    >
                      {!isUser && (
                        <TenderAvatar className="mt-1 h-8 w-8 border border-emerald-200" />
                      )}
                      <div className={cn("max-w-[82%]", isUser && "flex justify-end")}>
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                            isUser
                              ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/15"
                              : message.error
                                ? "border border-destructive/25 bg-destructive/10 text-destructive"
                                : "border border-border border-l-2 border-l-emerald-400 bg-white text-foreground shadow-sm",
                          )}
                        >
                          {isUser ? (
                            <p className="whitespace-pre-wrap">{message.content}</p>
                          ) : (
                            <div className="whitespace-pre-wrap">{renderMarkdown(message.content)}</div>
                          )}
                        </div>

                        {/* Model badge */}
                        {!isUser && !message.error && (message.provider || message.model) && (
                          <p className="mt-1 px-1 text-[10px] text-muted-foreground/60">
                            {[message.provider, message.model].filter(Boolean).join("/")}
                          </p>
                        )}

                        {/* Sources */}
                        {!isUser && message.sources && message.sources.length > 0 && (
                          <CollapsibleSources sources={message.sources} />
                        )}

                        {/* Follow-up questions */}
                        {!isUser && message.followUp && message.followUp.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {message.followUp.map((question) => (
                              <button
                                key={question}
                                type="button"
                                onClick={() => void sendQuestion(question)}
                                disabled={loading || tooManyDocuments}
                                className="rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-all hover:scale-[1.03] hover:border-emerald-300 hover:bg-emerald-100 hover:shadow-sm disabled:opacity-50"
                              >
                                {question}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Warnings */}
                        {!isUser && message.warnings && message.warnings.length > 0 && (
                          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            {message.warnings.slice(0, 2).join("; ")}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* ── Loading Bubble ── */}
                {loading && (
                  <div className="tender-msg-in flex items-center gap-3 text-sm text-muted-foreground">
                    <TenderAvatar className="h-8 w-8 border border-emerald-200" />
                    <div className="tender-shimmer-bg inline-flex items-center gap-3 rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
                      <ThinkingDots />
                      <span className="transition-all duration-300">{loadingTexts[loadingTextIdx]}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Input Area ── */}
          <form
            className="border-t border-border bg-gradient-to-t from-gray-50/80 to-white px-6 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void sendQuestion();
            }}
          >
            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
            <div className="flex items-end gap-3">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
                placeholder={
                  tenderTitle
                    ? "Спросите по лоту: " + tenderTitle.slice(0, 72)
                    : "Например: какой срок нужен по ТС?"
                }
                className="min-h-[3rem] resize-none rounded-xl border-border transition-shadow focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                disabled={loading}
              />
              <Button
                type="submit"
                className={cn(
                  "h-12 rounded-xl px-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md transition-all hover:from-emerald-600 hover:to-teal-600 hover:shadow-lg disabled:opacity-50 disabled:shadow-none",
                  hasInput && !loading && "animate-[tender-send-pulse_2s_ease-in-out_infinite]",
                )}
                disabled={loading || !hasInput || tooManyDocuments}
              >
                <Send className="h-4 w-4" />
                <span className="sr-only">Отправить</span>
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Enter отправляет · Shift+Enter — новая строка
            </p>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
