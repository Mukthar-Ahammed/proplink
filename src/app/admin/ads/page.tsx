import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import {
  DetailTabs,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { requireAdminPagePermission } from "@/lib/authz";
import { adsOverview } from "@/services/ads/ads";
import { AD_PLACEMENTS } from "@/services/ads/placements";

import {
  campaignImageAction,
  campaignStatusAction,
  createCampaignAction,
  decideApplicationAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Advertising | PropLink",
  robots: { index: false },
};

const field = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";
/** Default campaign dates: today and 30 days on (YYYY-MM-DD). */
function defaultDates() {
  const now = Date.now();
  return {
    today: new Date(now).toISOString().slice(0, 10),
    inMonth: new Date(now + 30 * 86_400_000).toISOString().slice(0, 10),
  };
}

const slotLabel = (slot: string) =>
  AD_PLACEMENTS[slot as keyof typeof AD_PLACEMENTS]?.label ?? slot;

/**
 * Advertising (Phase 6 Task 1, ADR-060): applications, advertisers and
 * campaigns in fixed designated slots. Pricing is recorded but nothing is
 * billed until the owner decides a model (OD-11).
 */
export default async function AdminAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireAdminPagePermission("ADVERTISER_MANAGEMENT");
  const overview = await adsOverview({
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  });
  if (!overview) return null;
  const { applications, advertisers, campaigns } = overview;
  const { today, inMonth } = defaultDates();
  const activeAdvertisers = advertisers.filter((a) => a.active).length;
  const tabs: DetailTab[] = [
    {
      key: "applications",
      label: "Applications",
      count: applications.length,
      attention: applications.length > 0,
    },
    { key: "campaigns", label: "Campaigns", count: campaigns.length },
    { key: "new", label: "New campaign" },
  ];
  const tab = pickTab((await searchParams).tab, tabs);
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Advertising"
        description="Sponsored placements only in the designated slots below, always labelled Sponsored. Never in search, chats, listings, offers or investment steps. No billing yet (OD-11)."
      />

      <DetailTabs
        basePath="/admin/ads"
        tabs={tabs}
        current={tab}
        label="Advertising sections"
      />

      {tab === "applications" && (
        <TabBody>
          <Panel
            title="Advertiser applications"
            description="Businesses asking to advertise. Approve to let them run campaigns, or decline with a reason."
            tone={applications.length > 0 ? "attention" : "default"}
          >
            {applications.length === 0 ? (
              <p className="text-sm text-muted">No applications waiting.</p>
            ) : (
              <ul className="space-y-3" data-testid="ad-applications">
                {applications.map((application) => (
                  <li
                    key={application.id}
                    className="rounded-lg border border-line p-3 text-sm"
                  >
                    <p className="font-semibold text-primary">
                      {application.businessName}{" "}
                      <span className="font-normal text-muted">
                        ({application.category.toLowerCase()}) · {application.contactName}
                        , {application.contactEmail} · {day(application.createdAt)}
                      </span>
                    </p>
                    <p className="text-xs text-muted">
                      Wants: {slotLabel(application.preferredSlot)},{" "}
                      {application.preferredFormat === "IMAGE_BANNER"
                        ? "image"
                        : "text card"}
                      {application.website && ` · ${application.website}`}
                    </p>
                    {application.message && (
                      <p className="mt-1 text-body">{application.message}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-start gap-3">
                      <ActionButton
                        action={decideApplicationAction}
                        hidden={{ applicationId: application.id, decision: "approve" }}
                        label="Approve advertiser"
                      />
                      <ActionButton
                        action={decideApplicationAction}
                        hidden={{ applicationId: application.id, decision: "reject" }}
                        label="Decline"
                        tone="danger"
                      >
                        <input
                          name="note"
                          required
                          placeholder="Reason"
                          aria-label="Reason for declining"
                          className={field}
                        />
                      </ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabBody>
      )}

      {tab === "new" && (
        <TabBody>
          <Panel
            title="New campaign"
            description={`A text card in one designated slot. Add an image after creating it. ${activeAdvertisers} approved advertiser${activeAdvertisers === 1 ? "" : "s"}.`}
          >
            {activeAdvertisers === 0 ? (
              <p className="text-sm text-muted">Approve an advertiser first.</p>
            ) : (
              <ActionButton
                action={createCampaignAction}
                hidden={{}}
                label="Create draft"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    name="advertiserId"
                    required
                    aria-label="Advertiser"
                    className={field}
                  >
                    {advertisers
                      .filter((a) => a.active)
                      .map((advertiser) => (
                        <option key={advertiser.id} value={advertiser.id}>
                          {advertiser.businessName}
                        </option>
                      ))}
                  </select>
                  <select name="slot" required aria-label="Placement" className={field}>
                    {Object.entries(AD_PLACEMENTS).map(([slot, placement]) => (
                      <option key={slot} value={slot}>
                        {placement.label}
                      </option>
                    ))}
                  </select>
                  <input
                    name="headline"
                    required
                    maxLength={60}
                    placeholder="Headline (60)"
                    aria-label="Headline"
                    className={field}
                  />
                  <input
                    name="body"
                    required
                    maxLength={140}
                    placeholder="Text (140)"
                    aria-label="Text"
                    className={field}
                  />
                  <input
                    name="destinationUrl"
                    required
                    placeholder="https://advertiser.example"
                    aria-label="Destination link"
                    className={field}
                  />
                  <div className="flex gap-2">
                    <input
                      name="startsAt"
                      type="date"
                      required
                      defaultValue={today}
                      aria-label="Starts"
                      className={field}
                    />
                    <input
                      name="endsAt"
                      type="date"
                      required
                      defaultValue={inMonth}
                      aria-label="Ends"
                      className={field}
                    />
                  </div>
                  <select
                    name="priceModel"
                    aria-label="Price model (recorded, not billed)"
                    className={field}
                  >
                    <option value="NONE">No price recorded</option>
                    <option value="FLAT_MONTHLY">Flat monthly</option>
                    <option value="CPM">Per 1,000 impressions</option>
                    <option value="CPC">Per click</option>
                  </select>
                  <input
                    name="pricePounds"
                    placeholder="Price £ (recorded only)"
                    aria-label="Price in pounds"
                    className={field}
                  />
                </div>
              </ActionButton>
            )}
          </Panel>
        </TabBody>
      )}

      {tab === "campaigns" && (
        <TabBody>
          <Panel
            title="Campaigns"
            description="Drafts need approval to go live. Pause, resume or end any campaign. Prices are recorded, never billed."
          >
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted">No campaigns yet.</p>
            ) : (
              <ul className="space-y-3" data-testid="ad-campaigns">
                {campaigns.map((campaign) => (
                  <li
                    key={campaign.id}
                    className="rounded-lg border border-line p-3 text-sm"
                  >
                    <p className="font-semibold text-primary">
                      {campaign.headline}{" "}
                      <span className="font-normal text-muted">
                        · {campaign.advertiser.businessName} · {slotLabel(campaign.slot)}{" "}
                        · {campaign.status.toLowerCase()} · {day(campaign.startsAt)} to{" "}
                        {day(campaign.endsAt)}
                      </span>
                    </p>
                    <p className="text-xs text-muted">
                      {campaign.body} · {campaign.destinationUrl} · {campaign.impressions}{" "}
                      impressions, {campaign.clicks} clicks
                      {campaign.priceModel !== "NONE" &&
                        ` · ${campaign.priceModel} £${(Number(campaign.pricePence ?? 0) / 100).toFixed(2)} (not billed)`}
                    </p>
                    <div className="mt-2 flex flex-wrap items-start gap-3">
                      {campaign.status === "DRAFT" && (
                        <ActionButton
                          action={campaignImageAction}
                          hidden={{ campaignId: campaign.id }}
                          label="Upload image"
                          tone="secondary"
                        >
                          <input
                            name="image"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            aria-label="Ad image (2 MB)"
                            className="text-sm"
                          />
                        </ActionButton>
                      )}
                      {(campaign.status === "DRAFT" || campaign.status === "PAUSED") && (
                        <ActionButton
                          action={campaignStatusAction}
                          hidden={{ campaignId: campaign.id, status: "ACTIVE" }}
                          label={
                            campaign.status === "DRAFT" ? "Approve and go live" : "Resume"
                          }
                        />
                      )}
                      {campaign.status === "ACTIVE" && (
                        <ActionButton
                          action={campaignStatusAction}
                          hidden={{ campaignId: campaign.id, status: "PAUSED" }}
                          label="Pause"
                          tone="secondary"
                        />
                      )}
                      {campaign.status !== "ENDED" && (
                        <ActionButton
                          action={campaignStatusAction}
                          hidden={{ campaignId: campaign.id, status: "ENDED" }}
                          label="End"
                          tone="danger"
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabBody>
      )}
    </div>
  );
}
