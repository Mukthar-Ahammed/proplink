import "server-only";

import { z } from "zod";
import {
  Role,
  FlipperAcquisitionStatus,
  FlipperProjectStatus,
  FlipperCostCategory,
  FlipperMilestoneStatus,
} from "@/generated/prisma/enums";
import { FlipperCaller, AgentCaller, hasFlipperCapability } from "./flipperService";

// ─── Input Schemas ───────────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  acquisitionId: z.string().min(1, "acquisitionId is required"),
  plannedBudgetGBP: z
    .number()
    .int("Budget must be in integer pence")
    .nonnegative("Planned budget cannot be negative")
    .optional(),
  targetCompletionDate: z.string().datetime().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const addProjectCostSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  category: z.nativeEnum(FlipperCostCategory).optional(),
  description: z.string().trim().min(3, "Description must be at least 3 characters").max(255),
  amountGBP: z
    .number()
    .int("Amount must be in integer pence")
    .positive("Cost amount must be positive"),
  incurredAt: z.string().datetime().optional(),
});

export type AddProjectCostInput = z.infer<typeof addProjectCostSchema>;

export const createMilestoneSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(255),
  description: z.string().trim().max(1000).optional(),
  targetDate: z.string().datetime().optional(),
});

export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;

// ─── Result Types ────────────────────────────────────────────────────────────

export type FlipperProjectResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Confirm Acquisition (Agent Only) ────────────────────────────────────────

export async function confirmFlipperAcquisition(
  agentCaller: AgentCaller,
  input: { acquisitionId: string; agentNotes?: string },
): Promise<FlipperProjectResult<{ acquisitionId: string }>> {
  if (!agentCaller.active || agentCaller.role !== Role.AGENT) {
    return { ok: false, error: "Only active Agent accounts can confirm acquisition completion" };
  }

  const { db } = await import("@/lib/db");

  const acq = await db.flipperAcquisition.findUnique({
    where: { id: input.acquisitionId },
    include: {
      property: {
        include: { agentProfile: true },
      },
    },
  });

  if (!acq) return { ok: false, error: "Acquisition record not found" };

  // Agent Ownership Guard
  if (!acq.property.agentProfile || acq.property.agentProfile.userId !== agentCaller.userId) {
    return { ok: false, error: "Forbidden: Agent A cannot confirm acquisitions for Agent B's listing" };
  }

  if (acq.status !== FlipperAcquisitionStatus.PENDING_COMPLETION) {
    return { ok: false, error: "Acquisition is no longer pending completion" };
  }

  const now = new Date();

  // Atomic conditional update
  const updatedCount = await db.$executeRaw`
    UPDATE public."FlipperAcquisition"
    SET "status" = 'COMPLETED'::"FlipperAcquisitionStatus",
        "completedAt" = ${now},
        "completedByUserId" = ${agentCaller.userId},
        "updatedAt" = ${now}
    WHERE "id" = ${input.acquisitionId}
      AND "status" = 'PENDING_COMPLETION'::"FlipperAcquisitionStatus"
  `;

  if (updatedCount === 0) {
    return { ok: false, error: "Acquisition is no longer pending completion (race condition or already decided)" };
  }

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: agentCaller.userId,
        action: "FLIPPER_ACQUISITION_COMPLETED",
        entity: "FlipperAcquisition",
        entityId: input.acquisitionId,
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { acquisitionId: input.acquisitionId } };
}

// ─── Cancel Acquisition (Agent Only) ─────────────────────────────────────────

export async function cancelFlipperAcquisition(
  agentCaller: AgentCaller,
  acquisitionId: string,
): Promise<FlipperProjectResult<{ acquisitionId: string }>> {
  if (!agentCaller.active || agentCaller.role !== Role.AGENT) {
    return { ok: false, error: "Only active Agent accounts can cancel acquisitions" };
  }

  const { db } = await import("@/lib/db");

  const acq = await db.flipperAcquisition.findUnique({
    where: { id: acquisitionId },
    include: {
      property: { include: { agentProfile: true } },
    },
  });

  if (!acq) return { ok: false, error: "Acquisition record not found" };

  if (!acq.property.agentProfile || acq.property.agentProfile.userId !== agentCaller.userId) {
    return { ok: false, error: "Forbidden: Agent A cannot manage acquisitions for Agent B's listing" };
  }

  if (acq.status !== FlipperAcquisitionStatus.PENDING_COMPLETION) {
    return { ok: false, error: "Only PENDING_COMPLETION acquisitions can be cancelled" };
  }

  const now = new Date();

  await db.flipperAcquisition.update({
    where: { id: acquisitionId },
    data: { status: FlipperAcquisitionStatus.CANCELLED, updatedAt: now },
  });

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: agentCaller.userId,
        action: "FLIPPER_ACQUISITION_CANCELLED",
        entity: "FlipperAcquisition",
        entityId: acquisitionId,
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { acquisitionId } };
}

// ─── Create Refurbishment Project (Investor Only) ───────────────────────────

export async function createFlipperProject(
  caller: FlipperCaller,
  input: CreateProjectInput,
): Promise<FlipperProjectResult<{ projectId: string }>> {
  if (!caller.active || caller.role !== Role.INVESTOR || !hasFlipperCapability(caller)) {
    return { ok: false, error: "Only active FLIPPER or BOTH investors can create refurbishment projects" };
  }

  const parse = createProjectSchema.safeParse(input);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Invalid project parameters" };
  }

  const { db } = await import("@/lib/db");

  const acq = await db.flipperAcquisition.findUnique({
    where: { id: input.acquisitionId },
  });

  if (!acq) return { ok: false, error: "Acquisition record not found" };

  // Investor Ownership Check
  if (acq.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this acquisition" };
  }

  // Precondition Invariant: Acquisition MUST be COMPLETED before creating a project!
  if (acq.status !== FlipperAcquisitionStatus.COMPLETED) {
    return {
      ok: false,
      error: "A refurbishment project can only be created for a COMPLETED acquisition (acquisition completion must be confirmed by the agent first)",
    };
  }

  // Prevent duplicate projects for the same acquisition
  const existingProject = await db.flipperProject.findUnique({
    where: { acquisitionId: input.acquisitionId },
  });

  if (existingProject) {
    return { ok: false, error: "A refurbishment project already exists for this acquisition" };
  }

  const project = await db.flipperProject.create({
    data: {
      acquisitionId: input.acquisitionId,
      investorUserId: caller.userId,
      propertyId: acq.propertyId,
      status: FlipperProjectStatus.PLANNING,
      plannedBudgetGBP: input.plannedBudgetGBP ?? 0,
      targetCompletionDate: input.targetCompletionDate ? new Date(input.targetCompletionDate) : null,
    },
  });

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_PROJECT_CREATED",
        entity: "FlipperProject",
        entityId: project.id,
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { projectId: project.id } };
}

// ─── Add Project Cost ────────────────────────────────────────────────────────

export async function addFlipperProjectCost(
  caller: FlipperCaller,
  input: AddProjectCostInput,
): Promise<FlipperProjectResult<{ costId: string }>> {
  if (!caller.active || caller.role !== Role.INVESTOR || !hasFlipperCapability(caller)) {
    return { ok: false, error: "Only active FLIPPER or BOTH investors can add project costs" };
  }

  const parse = addProjectCostSchema.safeParse(input);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Invalid cost parameters" };
  }

  const { db } = await import("@/lib/db");

  const project = await db.flipperProject.findUnique({
    where: { id: input.projectId },
  });

  if (!project) return { ok: false, error: "Project not found" };
  if (project.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this refurbishment project" };
  }

  const cost = await db.flipperProjectCost.create({
    data: {
      projectId: input.projectId,
      category: input.category ?? FlipperCostCategory.OTHER,
      description: input.description,
      amountGBP: input.amountGBP,
      incurredAt: input.incurredAt ? new Date(input.incurredAt) : new Date(),
    },
  });

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_PROJECT_COST_ADDED",
        entity: "FlipperProjectCost",
        entityId: cost.id,
        metaJson: { projectId: input.projectId, amountGBP: input.amountGBP },
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { costId: cost.id } };
}

// ─── Remove Project Cost ─────────────────────────────────────────────────────

export async function removeFlipperProjectCost(
  caller: FlipperCaller,
  costId: string,
): Promise<FlipperProjectResult<{ costId: string }>> {
  if (!caller.active || caller.role !== Role.INVESTOR || !hasFlipperCapability(caller)) {
    return { ok: false, error: "Only active FLIPPER or BOTH investors can remove project costs" };
  }

  const { db } = await import("@/lib/db");

  const cost = await db.flipperProjectCost.findUnique({
    where: { id: costId },
    include: { project: true },
  });

  if (!cost) return { ok: false, error: "Cost record not found" };
  if (cost.project.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this project" };
  }

  await db.flipperProjectCost.delete({
    where: { id: costId },
  });

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_PROJECT_COST_REMOVED",
        entity: "FlipperProjectCost",
        entityId: costId,
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { costId } };
}

// ─── Create Project Milestone ────────────────────────────────────────────────

export async function createProjectMilestone(
  caller: FlipperCaller,
  input: CreateMilestoneInput,
): Promise<FlipperProjectResult<{ milestoneId: string }>> {
  if (!caller.active || caller.role !== Role.INVESTOR || !hasFlipperCapability(caller)) {
    return { ok: false, error: "Only active FLIPPER or BOTH investors can manage milestones" };
  }

  const parse = createMilestoneSchema.safeParse(input);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Invalid milestone parameters" };
  }

  const { db } = await import("@/lib/db");

  const project = await db.flipperProject.findUnique({
    where: { id: input.projectId },
  });

  if (!project) return { ok: false, error: "Project not found" };
  if (project.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this project" };
  }

  const milestone = await db.flipperProjectMilestone.create({
    data: {
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: FlipperMilestoneStatus.TODO,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
    },
  });

  return { ok: true, data: { milestoneId: milestone.id } };
}

// ─── Update Milestone Status ─────────────────────────────────────────────────

export async function updateProjectMilestone(
  caller: FlipperCaller,
  milestoneId: string,
  input: { status?: FlipperMilestoneStatus; title?: string; description?: string },
): Promise<FlipperProjectResult<{ milestoneId: string }>> {
  if (!caller.active || caller.role !== Role.INVESTOR || !hasFlipperCapability(caller)) {
    return { ok: false, error: "Only active FLIPPER or BOTH investors can manage milestones" };
  }

  const { db } = await import("@/lib/db");

  const ms = await db.flipperProjectMilestone.findUnique({
    where: { id: milestoneId },
    include: { project: true },
  });

  if (!ms) return { ok: false, error: "Milestone not found" };
  if (ms.project.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this project" };
  }

  const now = new Date();
  const isCompleted = input.status === FlipperMilestoneStatus.COMPLETED;

  await db.flipperProjectMilestone.update({
    where: { id: milestoneId },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(isCompleted ? { completedAt: now } : {}),
      updatedAt: now,
    },
  });

  return { ok: true, data: { milestoneId } };
}

// ─── Get Project Detail Summary ──────────────────────────────────────────────

export type FlipperProjectDetail = {
  id: string;
  acquisitionId: string;
  propertyId: string;
  propertyTitle: string;
  city: string;
  postcode: string;
  agreedPriceGBP: number;
  status: FlipperProjectStatus;
  plannedBudgetGBP: number;
  totalCostsGBP: number;
  remainingBudgetGBP: number;
  isOverBudget: boolean;
  targetCompletionDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  costs: Array<{
    id: string;
    category: FlipperCostCategory;
    description: string;
    amountGBP: number;
    incurredAt: Date;
  }>;
  milestones: Array<{
    id: string;
    title: string;
    description: string | null;
    status: FlipperMilestoneStatus;
    targetDate: Date | null;
    completedAt: Date | null;
  }>;
};

export async function getFlipperProjectDetail(
  caller: FlipperCaller,
  projectId: string,
): Promise<FlipperProjectResult<FlipperProjectDetail>> {
  if (!caller.active || caller.role !== Role.INVESTOR || !hasFlipperCapability(caller)) {
    return { ok: false, error: "Only active FLIPPER or BOTH investors can access project details" };
  }

  const { db } = await import("@/lib/db");

  const proj = await db.flipperProject.findUnique({
    where: { id: projectId },
    include: {
      property: { select: { title: true, city: true, postcode: true } },
      acquisition: { select: { agreedPriceGBP: true } },
      costs: { orderBy: { incurredAt: "desc" } },
      milestones: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!proj) return { ok: false, error: "Project not found" };

  // Investor Ownership Isolation Guard
  if (proj.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: Investor A cannot access Investor B's refurbishment project" };
  }

  const totalCostsGBP = proj.costs.reduce((sum, c) => sum + c.amountGBP, 0);
  const remainingBudgetGBP = proj.plannedBudgetGBP - totalCostsGBP;

  return {
    ok: true,
    data: {
      id: proj.id,
      acquisitionId: proj.acquisitionId,
      propertyId: proj.propertyId,
      propertyTitle: proj.property.title,
      city: proj.property.city,
      postcode: proj.property.postcode,
      agreedPriceGBP: proj.acquisition.agreedPriceGBP,
      status: proj.status,
      plannedBudgetGBP: proj.plannedBudgetGBP,
      totalCostsGBP,
      remainingBudgetGBP,
      isOverBudget: remainingBudgetGBP < 0,
      targetCompletionDate: proj.targetCompletionDate,
      startedAt: proj.startedAt,
      completedAt: proj.completedAt,
      costs: proj.costs.map((c) => ({
        id: c.id,
        category: c.category,
        description: c.description,
        amountGBP: c.amountGBP,
        incurredAt: c.incurredAt,
      })),
      milestones: proj.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        status: m.status,
        targetDate: m.targetDate,
        completedAt: m.completedAt,
      })),
    },
  };
}
