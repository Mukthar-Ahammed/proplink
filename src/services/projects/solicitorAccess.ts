import "server-only";

import { ProjectSolicitorStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { Actor } from "@/services/projects/common";

/**
 * The Solicitor's scope (Phase 4 Task 5, ADR-047), kept apart from the
 * invitation service so pledge, agreement and ledger code can check it
 * without loading account provisioning.
 */

/**
 * The project a Solicitor may work on: only while their appointment is
 * ACTIVE. Closed accounts have no access (their records stay read-only for
 * everyone else). Returns null for anyone else.
 */
export async function solicitorProjectId(viewer: Actor): Promise<string | null> {
  if (viewer.role !== Role.SOLICITOR) return null;
  const row = await db.projectSolicitor.findFirst({
    where: {
      profileId: viewer.profileId,
      status: ProjectSolicitorStatus.ACTIVE,
      profile: { active: true, role: Role.SOLICITOR },
    },
    select: { projectId: true },
  });
  return row?.projectId ?? null;
}

/** True only for the ACTIVE Solicitor of exactly this project. */
export async function isProjectSolicitor(viewer: Actor, projectId: string) {
  return (await solicitorProjectId(viewer)) === projectId;
}
