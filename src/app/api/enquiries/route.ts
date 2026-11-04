import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { createEnquirySchema } from "@/services/enquiries/validation";
import { createEnquiry } from "@/services/enquiries/enquiryService";
import { EnquiryServiceError, enquiryErrorStatus } from "@/services/enquiries/errors";
import { verifyTurnstileToken } from "@/services/security/turnstile";

// TODO(H1.5): rate-limit with @upstash/ratelimit once Upstash keys exist.
export async function POST(request: Request) {
  // `Enquiry.fromUserId` is required (non-null) — no role restriction beyond
  // Current marketplace enquiries are Buyer-only; actor and role come from
  // the verified server session, never from request data.
  const authz = await requireRole("BUYER");
  if (!authz.ok) return authz.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createEnquirySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const verification = await verifyTurnstileToken(
    parsed.data.turnstileToken,
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  );
  if (!verification.ok) {
    return NextResponse.json(
      {
        error:
          verification.reason === "unavailable"
            ? "Security verification is temporarily unavailable."
            : "Please complete the security verification and try again.",
      },
      { status: verification.reason === "unavailable" ? 503 : 400 },
    );
  }

  try {
    const enquiry = await createEnquiry({
      userId: authz.session.user.id,
      role: authz.session.user.role,
      propertyId: parsed.data.propertyId,
      message: parsed.data.message,
      contactPhone: parsed.data.contactPhone,
    });
    return NextResponse.json(enquiry, { status: 201 });
  } catch (err) {
    if (err instanceof EnquiryServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: enquiryErrorStatus(err.code) },
      );
    }
    throw err;
  }
}
