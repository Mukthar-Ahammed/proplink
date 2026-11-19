import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActionButton } from "@/components/projects/ActionButton";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import { caseManagers, getCase } from "@/services/admin/cases";

import { caseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Case | PropLink", robots: { index: false } };

const field = "w-full rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";
const time = (value: Date) => value.toISOString().slice(0, 16).replace("T", " ");
const KIND: Record<string, string> = { NOTE: "Note", REPORT: "Report", EVENT: "Update" };

/** One case (Phase 6 Task 3, ADR-059). */
export default async function AdminCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdminPagePermission("CASE_MANAGEMENT");
  const { id } = await params;
  const admin = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const [item, managers] = await Promise.all([getCase(admin, id), caseManagers()]);
  if (!item) notFound();
  const working = ["OPEN", "IN_PROGRESS", "WAITING"].includes(item.status);
  const hidden = { caseId: item.id };
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={item.title}
        description={`${item.subjectType.toLowerCase()} case · ${item.status.replace("_", " ").toLowerCase()} · ${item.priority.toLowerCase()} priority · due ${time(item.slaDueAt)} UTC · ${item.reportCount} report(s)`}
      />
      <Card>
        <CardTitle>Subject</CardTitle>
        <CardBody>
          <p className="text-sm text-body" data-testid="case-subject">
            {item.link ? (
              <Link href={item.link} className="text-accent underline">
                Open the reported {item.subjectType.toLowerCase()}
              </Link>
            ) : (
              "The subject no longer exists."
            )}
            {item.subjectType === "CHAT" &&
              " (reading a private chat asks for a reason and is logged)."}
          </p>
          <p className="mt-2 text-sm text-muted">
            Owner:{" "}
            <span data-testid="case-assignee">{item.assignee?.name ?? "unassigned"}</span>
          </p>
          {working && (
            <div className="mt-3 flex flex-wrap items-start gap-3">
              <ActionButton
                action={caseAction}
                hidden={{ ...hidden, intent: "take" }}
                label="Assign to me"
                tone="secondary"
              />
              <ActionButton
                action={caseAction}
                hidden={{ ...hidden, intent: "assign" }}
                label="Assign"
                tone="secondary"
              >
                <select name="assigneeId" className={field} aria-label="Assign to">
                  <option value="">Nobody</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name ?? "Admin"}
                    </option>
                  ))}
                </select>
              </ActionButton>
              <ActionButton
                action={caseAction}
                hidden={{ ...hidden, intent: "status" }}
                label="Set status"
                tone="secondary"
              >
                <select
                  name="status"
                  className={field}
                  aria-label="Status"
                  defaultValue={item.status}
                >
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="WAITING">Waiting</option>
                </select>
              </ActionButton>
              <ActionButton
                action={caseAction}
                hidden={{ ...hidden, intent: "priority" }}
                label="Set priority"
                tone="secondary"
              >
                <select
                  name="priority"
                  className={field}
                  aria-label="Priority"
                  defaultValue={item.priority}
                >
                  <option value="HIGH">High (4 hours)</option>
                  <option value="NORMAL">Normal (24 hours)</option>
                  <option value="LOW">Low (72 hours)</option>
                </select>
              </ActionButton>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardTitle>History and notes</CardTitle>
        <CardBody>
          <ol className="space-y-3" data-testid="case-notes">
            {item.notes.map((note) => (
              <li key={note.id} className="rounded-lg border border-line p-3 text-sm">
                <p className="text-xs text-muted">
                  {KIND[note.kind] ?? note.kind} · {note.author?.name ?? "PropLink"} ·{" "}
                  {time(note.createdAt)} UTC
                </p>
                <p className="mt-1 whitespace-pre-line text-body">{note.body}</p>
              </li>
            ))}
          </ol>
          {item.status !== "CLOSED" && (
            <div className="mt-4">
              <ActionButton
                action={caseAction}
                hidden={{ ...hidden, intent: "note" }}
                label="Add note"
                tone="secondary"
              >
                <textarea
                  name="body"
                  required
                  rows={3}
                  className={field}
                  aria-label="Note"
                />
              </ActionButton>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Evidence</CardTitle>
        <CardBody>
          {item.evidence.length === 0 ? (
            <p className="text-sm text-muted">No evidence links yet.</p>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="case-evidence">
              {item.evidence.map((evidence) => (
                <li key={evidence.id}>
                  <a
                    href={evidence.url}
                    rel="noopener noreferrer nofollow"
                    target={evidence.url.startsWith("/") ? undefined : "_blank"}
                    className="text-accent underline"
                  >
                    {evidence.label}
                  </a>{" "}
                  <span className="text-muted">
                    · {evidence.adder.name ?? "Admin"} · {time(evidence.createdAt)} UTC
                  </span>
                </li>
              ))}
            </ul>
          )}
          {item.status !== "CLOSED" && (
            <div className="mt-4">
              <ActionButton
                action={caseAction}
                hidden={{ ...hidden, intent: "evidence" }}
                label="Add evidence link"
                tone="secondary"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    name="label"
                    required
                    placeholder="What it is"
                    aria-label="Evidence label"
                    className={field}
                  />
                  <input
                    name="url"
                    required
                    placeholder="/admin/... or https://..."
                    aria-label="Evidence link"
                    className={field}
                  />
                </div>
              </ActionButton>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Resolution</CardTitle>
        <CardBody>
          {item.resolution ? (
            <p className="text-sm text-body" data-testid="case-resolution">
              {item.resolution}{" "}
              <span className="text-muted">
                ({item.resolver?.name ?? "Admin"},{" "}
                {item.resolvedAt ? time(item.resolvedAt) : ""} UTC)
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted">Not resolved yet.</p>
          )}
          <div className="mt-3 flex flex-wrap items-start gap-3">
            {working && (
              <ActionButton
                action={caseAction}
                hidden={{ ...hidden, intent: "resolve" }}
                label="Resolve"
              >
                <textarea
                  name="resolution"
                  required
                  minLength={5}
                  rows={3}
                  className={field}
                  aria-label="Resolution"
                />
              </ActionButton>
            )}
            {item.status === "RESOLVED" && (
              <>
                <ActionButton
                  action={caseAction}
                  hidden={{ ...hidden, intent: "close" }}
                  label="Close"
                />
                <ActionButton
                  action={caseAction}
                  hidden={{ ...hidden, intent: "reopen" }}
                  label="Reopen"
                  tone="secondary"
                />
              </>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
