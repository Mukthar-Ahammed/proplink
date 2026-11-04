import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { AdminLoginForm } from "./AdminLoginForm";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const session = await auth();
  if (session?.user.role === "ADMIN") redirect("/admin");

  return <AdminLoginForm />;
}
