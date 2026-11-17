"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { confirmCompany, searchCompanies } from "@/services/agents/companyCheck";
import type { CompanySummary } from "@/services/companiesHouse/types";

export type SearchState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "results"; query: string; results: CompanySummary[] };

export type ConfirmState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "saved"; verified: boolean; companyName: string };

async function agentActor() {
  const authz = await requireRole(Role.AGENT);
  if (!authz.ok) return null;
  return {
    profileId: authz.session.user.authUserId,
    legacyUserId: authz.session.user.id,
  };
}

export async function searchCompaniesAction(
  _previous: SearchState,
  formData: FormData,
): Promise<SearchState> {
  const actor = await agentActor();
  if (!actor) return { kind: "error", message: "Agent access required" };
  const query = formData.get("query");
  const result = await searchCompanies(actor, query);
  if (!result.ok) return { kind: "error", message: result.error };
  return { kind: "results", query: String(query).trim(), results: result.results };
}

export async function confirmCompanyAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const actor = await agentActor();
  if (!actor) return { kind: "error", message: "Agent access required" };
  // Only the number is used; the server looks the company up again.
  const result = await confirmCompany(actor, formData.get("companyNumber"));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/agent/company");
  revalidatePath("/agent");
  return {
    kind: "saved",
    verified: result.result === "VERIFIED",
    companyName: result.company.companyName,
  };
}
