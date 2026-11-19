"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  counterpart: string;
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
  const outboxRef = useRef<Outgoing[]>([]);
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

  const lastMine = [...messages]
    .reverse()
    .find((message) => message.senderId === viewerId);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted" aria-live="polite">
        {live ? "Live" : "Updates every few seconds"} · Messages cannot be edited or
        deleted.
      </p>
      <ol
        ref={listRef}
        className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border border-line bg-white p-4"
        aria-label="Messages"
      >
        {messages.length === 0 && outbox.length === 0 && (
          <li className="text-sm text-muted">No messages yet.</li>
        )}
        {messages.map((message) => {
          const mine = message.senderId === viewerId;
          return (
            <li
              key={message.id}
              className={mine ? "text-right" : "text-left"}
              data-testid="chat-message"
            >
              <div
                className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-sm ${mine ? "bg-primary text-white" : "bg-surface text-body"}`}
              >
                {message.body && (
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                )}
                {message.attachments.map((file) => (
                  <p key={file.fileId} className="mt-1">
                    {file.url ? (
                      <a href={file.url} className="underline" rel="noopener noreferrer">
                        {file.name}
                      </a>
                    ) : (
                      <span>{file.name} (unavailable)</span>
                    )}
                  </p>
                ))}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {mine ? "You" : props.counterpart} ·{" "}
                {new Date(message.createdAt).toLocaleString("en-GB")}
                {mine && message === lastMine && message.readAt ? " · Read" : ""}
              </p>
            </li>
          );
        })}
        {outbox.map((item) => (
          <li
            key={item.clientMessageId}
            className="text-right"
            data-testid="chat-outgoing"
          >
            <div className="inline-block max-w-[85%] rounded-lg bg-primary/60 px-3 py-2 text-left text-sm text-white">
              <p className="whitespace-pre-wrap break-words">
                {item.body || "(attachment)"}
              </p>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {item.status === "sending"
                ? "Sending…"
                : item.status === "queued"
                  ? "Waiting for connection; will send automatically"
                  : `Not sent: ${item.error ?? "refused"}`}
            </p>
          </li>
        ))}
      </ol>

      {notice && (
        <p role="status" className="text-sm text-warning">
          {notice}
        </p>
      )}

      {canSend && (
        <div className="space-y-2">
          <label className="sr-only" htmlFor="chat-draft">
            Message
          </label>
          <textarea
            id="chat-draft"
            value={draft}
            maxLength={4000}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
            placeholder="Write a message"
          />
          {pending.length > 0 && (
            <p className="text-xs text-muted">
              Attached: {pending.map((file) => file.name).join(", ")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={send}
              disabled={uploading}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Send
            </button>
            <label className="cursor-pointer text-sm font-semibold text-primary underline">
              {uploading ? "Scanning…" : "Attach a file"}
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
          </div>
        </div>
      )}

      <div className="border-t border-line pt-3">
        {reporting ? (
          <form action={report} className="space-y-2">
            <label className="block text-sm font-medium text-primary">
              What is wrong with this chat?
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1000}
                rows={2}
                className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
              />
            </label>
            <div className="flex gap-2">
              <button className="rounded-lg border border-danger px-3 py-1.5 text-sm font-semibold text-danger">
                Send report
              </button>
              <button
                type="button"
                onClick={() => setReporting(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setReporting(true)}
            className="text-xs text-muted underline"
          >
            Report this chat
          </button>
        )}
        {reportNote && (
          <p role="status" className="mt-2 text-sm text-muted">
            {reportNote}
          </p>
        )}
      </div>
    </div>
  );
}
