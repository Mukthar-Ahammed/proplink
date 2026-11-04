import crypto from "node:crypto";

export async function provisionLegacyIdentity(db, { authUserId, email, name, role, kycStatus = "NOT_STARTED" }) {
  if (!authUserId || !email || !name || !role) throw new Error("Incomplete identity input");
  return db.transaction(async (tx) => {
    const existing = await tx.query("SELECT id FROM public.\"User\" WHERE email=$1", [email]);
    if (existing.rows.length) throw new Error("Disposable identity already exists");
    const profile = await tx.query("SELECT id, \"legacyUserId\" FROM public.profiles WHERE id=$1::uuid FOR UPDATE", [authUserId]);
    if (profile.rows.length !== 1 || profile.rows[0].legacyUserId) throw new Error("Auth profile missing or already mapped");
    const legacyId = crypto.randomUUID();
    await tx.query(`INSERT INTO public."User" (id,email,name,role,"kycStatus",active,"emailVerified") VALUES ($1,$2,$3,$4::public."Role",$5::public."KycStatus",true,now())`, [legacyId, email, name, role, kycStatus]);
    await tx.query(`UPDATE public.profiles SET "legacyUserId"=$1, role=$2::public."Role", name=$3, "kycStatus"=$4::public."KycStatus", active=true WHERE id=$5::uuid`, [legacyId, role, name, kycStatus, authUserId]);
    return { authUserId, legacyUserId: legacyId, email, role };
  });
}
