"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { PersonName } from "@/components/profiles/PersonName";
import { ActionMenu } from "@/components/ui/action-menu";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";

type Attachment = { fileId: string; name: string; url: string | null };
type Message = {
  id: string;
  senderId: string;
  body: string;
  clientMessageId: string;
  createdAt: string;
  readAt: string | null;
  attachments: Attachment[];
};
type Outgoing = {
  clientMessageId: string;
  body: string;
  attachmentIds: string[];
  status: "sending" | "queued" | "failed";
  error?: string;
};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dayFormat.format(date);
}

const icon = "h-4 w-4";
function DotsVerticalIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={icon}>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}
function DotsHorizontalIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}
function FlagIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={icon}
    >
      <path d="M4 22V4a1 1 0 0 1 .4-.8C5.6 2.4 7 2 9 2c3 0 4 2 7 2 1.4 0 2.6-.3 3.6-.8V14c-1 .5-2.2.8-3.6.8-3 0-4-2-7-2-2 0-3.4.4-5 1.2" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={icon}
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}
function PaperclipIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="m21 12-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

const POLL_MS = 4000;
const RETRY_MS = 5000;

function newKey(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(
    /[^A-Za-z0-9_-]/g,
    "",
  );
}

/**
 * One chat (Phase 3 Task 3, ADR-043). Messages arrive by polling and, where
 * Supabase Realtime is configured, a private broadcast channel. Unsent
 * messages wait in a local outbox and are retried with the same key, so a
 * flaky connection never duplicates a message. Text is rendered as text.
 */
export function ChatWindow(props: {
  threadId: string;
  viewerId: string;
  /** Shown as the viewer's avatar initials; "You" when unknown. */
  viewerName?: string | null;
  counterpart: string;
  /** Server-derived: the counterpart carries the verified badge (ADR-027). */
  counterpartVerified?: boolean;
  /** Signed photo links, or null for initials (decided server-side). */
  counterpartPhotoUrl?: string | null;
  viewerPhotoUrl?: string | null;
  /** What the chat is about (property or project title), shown in the header. */
  context?: string;
  initialMessages: Message[];
  initialCanSend: boolean;
  initialNotice: string | null;
}) {
  const { threadId, viewerId } = props;
  const outboxKey = `proplink-chat-outbox:${threadId}`;
  const [messages, setMessages] = useState<Message[]>(props.initialMessages);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [canSend, setCanSend] = useState(props.initialCanSend);
  const [notice, setNotice] = useState<string | null>(props.initialNotice);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const outboxRef = useRef<Outgoing[]>([]);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Restore unsent messages from a previous visit (offline queue).
  useEffect(() => {
    // Deferred a tick: localStorage exists only in the browser, after hydration.
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(outboxKey) ?? "[]") as Outgoing[];
        const restored = saved.map((item) => ({ ...item, status: "queued" as const }));
        outboxRef.current = restored;
        setOutbox(restored);
      } catch {
        // Storage unavailable: the outbox lives in memory only.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [outboxKey]);

  const saveOutbox = useCallback(
    (next: Outgoing[]) => {
      outboxRef.current = next;
      setOutbox(next);
      try {
        localStorage.setItem(outboxKey, JSON.stringify(next));
      } catch {
        // Ignore: memory copy still works for this visit.
      }
    },
    [outboxKey],
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/chat/threads/${threadId}/messages`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        messages: Message[];
        canSend: boolean;
        blocked: string | null;
      };
      setMessages(data.messages);
      setCanSend(data.canSend);
      setNotice(
        data.blocked === "your_subscription"
          ? "Your subscription is not active, so this chat is read-only until you renew."
          : data.blocked === "their_subscription"
            ? "This chat is read-only until the other person renews their subscription."
            : data.blocked === "closed"
              ? "This chat is closed. You can still read its history."
              : data.blocked === "pending"
                ? "PropLink has not authorised this chat yet."
                : null,
      );
      // Drop delivered items from the outbox.
      const delivered = new Set(data.messages.map((message) => message.clientMessageId));
      if (outboxRef.current.some((item) => delivered.has(item.clientMessageId))) {
        saveOutbox(
          outboxRef.current.filter((item) => !delivered.has(item.clientMessageId)),
        );
      }
      if (
        data.messages.some((message) => message.senderId !== viewerId && !message.readAt)
      ) {
        void fetch(`/api/chat/threads/${threadId}/read`, {
          method: "POST",
          headers: { "X-Proplink-Request": "1" },
        });
      }
    } catch {
      // Offline: try again on the next tick.
    }
  }, [threadId, viewerId, saveOutbox]);

  const deliver = useCallback(
    async (item: Outgoing) => {
      try {
        const response = await fetch(`/api/chat/threads/${threadId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Proplink-Request": "1" },
          body: JSON.stringify({
            body: item.body,
            clientMessageId: item.clientMessageId,
            attachmentIds: item.attachmentIds,
          }),
        });
        if (response.ok) {
          saveOutbox(
            outboxRef.current.filter((o) => o.clientMessageId !== item.clientMessageId),
          );
          await refresh();
          return;
        }
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        // 429 and 5xx: try again later. Other refusals: show why.
        const retry = response.status === 429 || response.status >= 500;
        saveOutbox(
          outboxRef.current.map((o) =>
            o.clientMessageId === item.clientMessageId
              ? { ...o, status: retry ? "queued" : "failed", error: data.error }
              : o,
          ),
        );
      } catch {
        saveOutbox(
          outboxRef.current.map((o) =>
            o.clientMessageId === item.clientMessageId ? { ...o, status: "queued" } : o,
          ),
        );
      }
    },
    [threadId, refresh, saveOutbox],
  );

  // Polling and queued retries; flush immediately when back online.
  useEffect(() => {
    const flush = () => {
      for (const item of outboxRef.current)
        if (item.status === "queued") void deliver(item);
    };
    const poll = setInterval(() => void refresh(), POLL_MS);
    const retry = setInterval(flush, RETRY_MS);
    const online = () => {
      flush();
      void refresh();
    };
    window.addEventListener("online", online);
    return () => {
      clearInterval(poll);
      clearInterval(retry);
      window.removeEventListener("online", online);
    };
  }, [refresh, deliver]);

  // Supabase Realtime private channel (only the two participants may join).
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const supabase = createClient();
        await supabase.realtime.setAuth();
        if (cancelled) return;
        const channel = supabase
          .channel(`thread:${threadId}`, { config: { private: true } })
          .on("broadcast", { event: "*" }, () => void refresh())
          .subscribe((status) => setLive(status === "SUBSCRIBED"));
        cleanup = () => void supabase.removeChannel(channel);
      } catch {
        setLive(false);
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [threadId, refresh]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages.length, outbox.length]);

  function send() {
    const body = draft.trim();
    if (!body && pending.length === 0) return;
    const item: Outgoing = {
      clientMessageId: newKey(),
      body,
      attachmentIds: pending.map((file) => file.fileId),
      status: "sending",
    };
    saveOutbox([...outboxRef.current, item]);
    setDraft("");
    setPending([]);
    void deliver(item);
  }

  async function attach(file: File) {
    setUploading(true);
    try {
      const response = await fetch("/api/uploads/files", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "X-Upload-Purpose": "document",
          "X-Proplink-Request": "1",
        },
        body: file,
      });
      const data = (await response.json().catch(() => ({}))) as {
        fileId?: string;
        error?: string;
      };
      if (!response.ok || !data.fileId) {
        setNotice(data.error ?? "The file could not be uploaded.");
        return;
      }
      setPending((current) => [
        ...current,
        { fileId: data.fileId!, name: file.name, url: null },
      ]);
    } catch {
      setNotice("The file could not be uploaded. Check your connection.");
    } finally {
      setUploading(false);
    }
  }

  async function report(formData: FormData) {
    const response = await fetch(`/api/chat/threads/${threadId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Proplink-Request": "1" },
      body: JSON.stringify({ reason: String(formData.get("reason") ?? "") }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setReportNote(
      response.ok
        ? "Thank you. PropLink will review this chat."
        : (data.error ?? "Could not send the report."),
    );
    if (response.ok) setReporting(false);
  }

  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.body);
      setCopied(message.id);
      window.setTimeout(() => setCopied((id) => (id === message.id ? null : id)), 2000);
    } catch {
      // Clipboard blocked (insecure origin or permission): nothing to copy to.
    }
  }

  const lastMine = [...messages]
    .reverse()
    .find((message) => message.senderId === viewerId);
  const viewerName = props.viewerName?.trim() || "You";

  return (
    <section
      aria-label={`Conversation with ${props.counterpart}`}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-line bg-white"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {/* Phones show one pane at a time: back to the list. */}
          <Link
            href="/messages"
            aria-label="All messages"
            className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-surface lg:hidden"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <Avatar name={props.counterpart} src={props.counterpartPhotoUrl} />
          <div className="min-w-0">
            <p className="flex text-base font-semibold text-primary">
              <PersonName
                name={props.counterpart}
                verified={Boolean(props.counterpartVerified)}
              />
            </p>
            {props.context && (
              <p className="truncate text-xs font-medium text-accent">{props.context}</p>
            )}
            <p
              className="flex items-center gap-1.5 text-xs text-muted"
              aria-live="polite"
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block h-2.5 w-2.5 rounded-full border-2 border-white",
                  live ? "bg-success" : "bg-muted/50",
                )}
              />
              {live ? "Live" : "Updates every few seconds"}
            </p>
          </div>
        </div>
        <ActionMenu
          label="Chat actions"
          trigger={<DotsVerticalIcon />}
          items={[
            {
              label: "Report this chat",
              icon: <FlagIcon />,
              tone: "danger",
              onSelect: () => {
                setReportNote(null);
                setReporting(true);
              },
            },
          ]}
        />
      </header>

      {/* Report form (opened from either menu) */}
      {reporting && (
        <form
          action={report}
          className="space-y-2 border-b border-line bg-surface px-4 py-3"
        >
          <label className="block text-sm font-medium text-primary">
            What is wrong with this chat?
            <textarea
              name="reason"
              required
              minLength={10}
              maxLength={1000}
              rows={2}
              autoFocus
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
            />
          </label>
          <div className="flex gap-2">
            <button className="rounded-lg border border-danger bg-white px-3 py-1.5 text-sm font-semibold text-danger">
              Send report
            </button>
            <button
              type="button"
              onClick={() => setReporting(false)}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {reportNote && (
        <p
          role="status"
          className="border-b border-line bg-pale px-4 py-2 text-sm text-body"
        >
          {reportNote}
        </p>
      )}

      {/* Messages */}
      <ol
        ref={listRef}
        aria-label="Messages"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-surface/70 to-white px-4 py-5 sm:px-6"
      >
        {messages.length === 0 && outbox.length === 0 && (
          <li className="flex h-full flex-col items-center justify-center text-center text-sm text-muted">
            <Avatar
              name={props.counterpart}
              src={props.counterpartPhotoUrl}
              className="mb-3"
            />
            No messages yet. Say hello to {props.counterpart}.
          </li>
        )}
        {messages.map((message, index) => {
          const mine = message.senderId === viewerId;
          const newDay =
            index === 0 ||
            dayKey(messages[index - 1].createdAt) !== dayKey(message.createdAt);
          const sent = new Date(message.createdAt);
          return (
            <li key={message.id} data-testid="chat-message">
              {newDay && (
                <p className="my-2 flex items-center gap-3 text-xs font-medium text-muted">
                  <span aria-hidden className="h-px flex-1 bg-line" />
                  {dayLabel(message.createdAt)}
                  <span aria-hidden className="h-px flex-1 bg-line" />
                </p>
              )}
              <div className={cn("group flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "flex max-w-[85%] items-start gap-2 sm:max-w-[75%]",
                    mine && "flex-row-reverse",
                  )}
                >
                  <Avatar
                    name={mine ? viewerName : props.counterpart}
                    src={mine ? props.viewerPhotoUrl : props.counterpartPhotoUrl}
                    tone={mine ? "accent" : "neutral"}
                    size="sm"
                  />
                  <div className={cn("min-w-0", mine && "flex flex-col items-end")}>
                    <span className="sr-only">{mine ? "You" : props.counterpart}:</span>
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2 text-sm",
                        mine
                          ? "rounded-tr-md bg-accent text-white"
                          : "rounded-tl-md bg-surface text-body",
                      )}
                    >
                      {message.body && (
                        <p className="whitespace-pre-wrap break-words">{message.body}</p>
                      )}
                      {message.attachments.map((file) => (
                        <p key={file.fileId} className={cn(message.body && "mt-1")}>
                          {file.url ? (
                            <a
                              href={file.url}
                              className="font-medium underline"
                              rel="noopener noreferrer"
                            >
                              📎 {file.name}
                            </a>
                          ) : (
                            <span>📎 {file.name} (unavailable)</span>
                          )}
                        </p>
                      ))}
                    </div>
                    <div
                      className={cn(
                        "mt-1 flex items-center gap-1.5",
                        mine && "flex-row-reverse",
                      )}
                    >
                      <time
                        dateTime={message.createdAt}
                        title={sent.toLocaleString("en-GB")}
                        className="text-xs text-muted"
                      >
                        {timeFormat.format(sent)}
                        {mine && message === lastMine && message.readAt ? " · Read" : ""}
                        {copied === message.id ? " · Copied" : ""}
                      </time>
                      {message.body && (
                        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                          <ActionMenu
                            label="Message actions"
                            align={mine ? "right" : "left"}
                            trigger={<DotsHorizontalIcon />}
                            triggerClassName="h-7 w-7 bg-white"
                            items={[
                              {
                                label: "Copy",
                                icon: <CopyIcon />,
                                onSelect: () => void copy(message),
                              },
                              ...(mine
                                ? []
                                : [
                                    {
                                      label: "Report",
                                      icon: <FlagIcon />,
                                      tone: "danger" as const,
                                      onSelect: () => {
                                        setReportNote(null);
                                        setReporting(true);
                                      },
                                    },
                                  ]),
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
        {outbox.map((item) => (
          <li key={item.clientMessageId} data-testid="chat-outgoing">
            <div className="flex justify-end">
              <div className="flex max-w-[85%] flex-row-reverse items-start gap-2 sm:max-w-[75%]">
                <Avatar
                  name={viewerName}
                  src={props.viewerPhotoUrl}
                  tone="accent"
                  size="sm"
                  className="opacity-60"
                />
                <div className="flex min-w-0 flex-col items-end">
                  <div className="rounded-2xl rounded-tr-md bg-accent/60 px-3.5 py-2 text-sm text-white">
                    <p className="whitespace-pre-wrap break-words">
                      {item.body || "(attachment)"}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      item.status === "failed" ? "text-danger" : "text-muted",
                    )}
                  >
                    {item.status === "sending"
                      ? "Sending…"
                      : item.status === "queued"
                        ? "Waiting for connection; will send automatically"
                        : `Not sent: ${item.error ?? "refused"}`}
                  </p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {notice && (
        <p
          role="status"
          className="border-t border-line bg-premium-soft px-4 py-2 text-sm text-warning"
        >
          {notice}
        </p>
      )}

      {/* Composer */}
      {canSend && (
        <div className="border-t border-line px-3 py-3 sm:px-4">
          {pending.length > 0 && (
            <p className="mb-2 flex flex-wrap gap-1.5 text-xs text-muted">
              {pending.map((file) => (
                <span
                  key={file.fileId}
                  className="rounded-full bg-pale px-2 py-0.5 font-medium text-accent"
                >
                  📎 {file.name}
                </span>
              ))}
            </p>
          )}
          <div className="flex items-end gap-2">
            <label
              className={cn(
                "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-surface focus-within:ring-2 focus-within:ring-accent",
                uploading && "cursor-wait opacity-60",
              )}
              title={uploading ? "Scanning…" : "Attach a file"}
            >
              <PaperclipIcon />
              <span className="sr-only">{uploading ? "Scanning…" : "Attach a file"}</span>
              <input
                type="file"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attach(file);
                  event.target.value = "";
                }}
              />
            </label>
            <label className="sr-only" htmlFor="chat-draft">
              Message
            </label>
            <textarea
              ref={draftRef}
              id="chat-draft"
              value={draft}
              maxLength={4000}
              rows={1}
              onChange={(event) => {
                setDraft(event.target.value);
                const box = event.target;
                box.style.height = "auto";
                box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                  if (draftRef.current) draftRef.current.style.height = "auto";
                }
              }}
              className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2 text-sm text-body focus:border-accent focus:bg-white focus:outline-none"
              placeholder={`Message ${props.counterpart}`}
            />
            <button
              type="button"
              aria-label="Send"
              onClick={() => {
                send();
                if (draftRef.current) draftRef.current.style.height = "auto";
              }}
              disabled={uploading || (!draft.trim() && pending.length === 0)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-colors hover:bg-accent-strong disabled:opacity-50"
            >
              <SendIcon />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-muted">
            Enter to send · Shift + Enter for a new line · Messages cannot be edited or
            deleted.
          </p>
        </div>
      )}
    </section>
  );
}
