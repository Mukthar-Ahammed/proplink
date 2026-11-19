import { ActionButton } from "@/components/projects/ActionButton";
import { AD_CATEGORIES } from "@/services/ads/ads";
import { AD_PLACEMENTS } from "@/services/ads/placements";

import { applyToAdvertiseAction } from "./actions";

export const metadata = {
  title: "Advertise with PropLink UK",
  description:
    "Surveyors, contractors, brokers, insurers and other property businesses can apply to advertise in PropLink's sponsored placements.",
};

const field =
  "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body";
const CATEGORY: Record<string, string> = {
  SURVEYOR: "Surveyor",
  CONTRACTOR: "Contractor",
  BROKER: "Broker",
  INSURER: "Insurer",
  OTHER: "Other property business",
};

/**
 * Advertiser application (Phase 6 Task 1, ADR-060; Clarification Answers G):
 * any business team applies with its preferred placement and format; an
 * Admin approves the final slots. Ads never interrupt search, chats, offers
 * or pledges and are always labelled Sponsored.
 */
export default function AdvertisePage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">Advertise with PropLink UK</h1>
        <p className="mt-2 text-sm text-body">
          Reach landlords, agents and investors in a small number of clearly labelled
          sponsored spaces. Ads never appear in search, messages, offers or investment
          steps, and never pop up. Tell us what you would like; our team agrees the final
          placement with you.
        </p>
      </header>
      <ActionButton action={applyToAdvertiseAction} hidden={{}} label="Send application">
        <div className="space-y-4">
          <label className="block text-sm text-body">
            Business name
            <input
              name="businessName"
              required
              minLength={2}
              maxLength={120}
              className={field}
            />
          </label>
          <label className="block text-sm text-body">
            What your business does
            <select name="category" required className={field}>
              {AD_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY[category]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-body">
              Your name
              <input
                name="contactName"
                required
                minLength={2}
                maxLength={120}
                className={field}
              />
            </label>
            <label className="block text-sm text-body">
              Email
              <input
                name="contactEmail"
                type="email"
                required
                maxLength={254}
                className={field}
              />
            </label>
          </div>
          <label className="block text-sm text-body">
            Website (https, optional)
            <input name="website" type="url" placeholder="https://" className={field} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-body">
              Preferred placement
              <select name="preferredSlot" required className={field}>
                {Object.entries(AD_PLACEMENTS).map(([slot, placement]) => (
                  <option key={slot} value={slot}>
                    {placement.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-body">
              Preferred format
              <select name="preferredFormat" required className={field}>
                <option value="TEXT_CARD">Text card</option>
                <option value="IMAGE_BANNER">Small image with text</option>
              </select>
            </label>
          </div>
          <label className="block text-sm text-body">
            Anything else (optional)
            <textarea name="message" maxLength={1000} rows={3} className={field} />
          </label>
        </div>
      </ActionButton>
    </main>
  );
}
