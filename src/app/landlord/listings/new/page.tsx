import { requirePageRole } from "@/lib/authz";
import {
  ArrowLink,
  EyeIcon,
  IconChip,
  InvestorSectionTitle,
  PenIcon,
  ShieldIcon,
  UploadIcon,
} from "@/components/investor/InvestorUi";

import { NewListingForm } from "./NewListingForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "List a property — PropLink UK" };

const NEXT_STEPS = [
  {
    icon: <PenIcon />,
    title: "Add the details",
    body: "Address, description, known defects, the work needed and what you'd like to happen.",
  },
  {
    icon: <UploadIcon />,
    title: "Attach your documents",
    body: "Photos and an ownership document, such as title deeds or the Land Registry title.",
  },
  {
    icon: <ShieldIcon />,
    title: "Submit for review",
    body: "Once your identity check is approved. PropLink usually reviews within 30–60 minutes.",
  },
  {
    icon: <EyeIcon />,
    title: "Verified agents see it",
    body: "Only PropLink-verified agents, never the public and never search.",
  },
];

/** Start a private listing (Phase 2 Task 1). Saved as a draft straight away. */
export default async function NewLandlordListingPage() {
  await requirePageRole("LANDLORD");
  return (
    <div className="space-y-8">
      <InvestorSectionTitle
        title="List a"
        tail="property"
        description="Start with a short title. It's saved as a private draft; nobody else sees it until you submit it and PropLink approves it."
        action={<ArrowLink href="/landlord/listings">My properties</ArrowLink>}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7">
          <NewListingForm />
        </div>
        <div className="rounded-3xl border border-accent/20 bg-pale/70 p-6 sm:p-7">
          <p className="font-semibold text-primary">What happens next</p>
          <ol className="mt-5 space-y-5">
            {NEXT_STEPS.map((step) => (
              <li key={step.title} className="flex items-start gap-3">
                <IconChip>{step.icon}</IconChip>
                <div>
                  <p className="text-sm font-semibold text-primary">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
