import { redirect } from "next/navigation";

import { adminLoginStep } from "./actions";
import { AdminLoginForm } from "./AdminLoginForm";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  // An Admin who has signed in with a password but not yet given the second
  // factor lands back here on the code card, not on a page with site chrome.
  const step = await adminLoginStep();
  if (step === "done") redirect("/admin");

  return <AdminLoginForm initialStep={step} />;
}
