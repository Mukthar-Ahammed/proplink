import type { Role } from "@/generated/prisma/enums";

/** Roles that must use a second factor (Phase 1 Task 11, ADR-030). */
export const MFA_REQUIRED_ROLES: readonly Role[] = ["ADMIN", "SOLICITOR"];
