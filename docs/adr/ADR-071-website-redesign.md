# ADR-071: Website redesign — clean, light, modern UI

**Status:** Accepted (owner-requested, 2026-11-18)
**Date:** 2026-11-18
**Supersedes (visual direction only):** ADR-009, ADR-012, ADR-014 colour/type
choices; ADR-008 scroll-orbit hero; the ADR-009/016 "no navigation" header.

## Context

The owner asked for the whole website UI to be redesigned in a clean, modern
style, taking the mood, colour theme, card style and layout (not content or
unrelated elements) from two reference images in `docs/design/references/`:

- a real-estate template: white page, deep teal primary buttons, rounded cards
  with hairline borders, pill chips, a property detail page with a large
  gallery plus thumbnail column and a sticky right rail (tour/agent cards);
- a travel landing page: full-bleed photo hero with a transparent nav,
  headlines mixing sans with an italic serif word, small pill eyebrows, image
  cards with white pill buttons, a bento of dark / photo / light cards, and a
  row of large light numerals.

The navbar, footer and every other page had to match.

## Decision

- **Tokens** (`src/app/globals.css`): white/neutral grounds, `line #E3E8E6`
  hairlines, `accent #0F6B5E` deep teal as the single brand hue (new
  `accent-strong` for hover), `brand #0F1F1C` repurposed as a dark _card_
  ground. Semantic colours unchanged. Full table in `ARCHITECTURE.md §Design
system` and the spec.
- **Type:** Figtree stays for UI and headlines; **Instrument Serif italic**
  added as the headline accent (`font-serif italic`).
- **Shape:** pill buttons and chips, `rounded-xl` inputs, `rounded-2xl/3xl`
  cards with borders instead of shadows.
- **Chrome:** sticky floating white pill header (inset, rounded-full, soft
  shadow; restyled from a fourth owner reference) with centred public links
  (existing pages only) and `Log in` + `Get started`; on `/` it floats over the
  hero gradient, elsewhere a spacer reserves its height;
  hidden on auth routes and `/admin/*`. New multi-column `surface` footer.
- **Pages:** new landing page; light mastheads for marketplace and portals;
  property detail rebuilt on the reference's gallery + sticky rail layout;
  auth shell becomes form + rounded photo card (amended 2026-11-19: photo card
  removed, the form is now one centred card on every screen size); admin sidebar/header restyled;
  floating cookie card with equal-weight buttons.
- **Removed:** `HeroStage` scroll orbit, `RenderObject` stand-ins,
  `PlatformEcosystem` marquee, `plateWash`, `scrollOrbit` and its unit test,
  and the two orbit e2e tests — decorative elements that do not fit the
  direction.
- **Hero (revised):** at the owner’s request the photo hero was replaced by a
  light hero modelled on a third reference (dotted map with markers), revised
  after owner feedback (too tall, too white, ring did not fit, next section felt
  detached) into a split layout on a teal-mist gradient with the live stats
  card bridging into How it works: a dot-matrix UK map with pulsing and pop-in pins
  indicating new listings. Pins are illustrative, not real listing positions,
  and carry no details. `/` no longer uses the transparent overlay header.
- **Marketplace masthead (revised):** the plain grey title band became a
  compact teal-mist banner with a live listing count and a cropped slice of the
  hero's dotted UK map, so the catalogue reads as part of the same site.
- **Buyer search (`/buy`):** after owner feedback that too many options were on
  view, the filter sidebar became a compact search bar (search, sort, and a
  "Filters" button opening the rest in a panel, with applied filters as
  removable chips) with a "What can you spend?" button opening the affordability
  calculator in the same bar. Results use the full width. No filter or
  calculator input was removed; `/marketplace` keeps its sidebar. The masthead
  uses the owner-supplied buyer banner photo under the landing hero gradient
  and runs up behind the header pill, so header and masthead read as one
  surface.
- **Profile editor:** the bare single-column profile form became section
  cards (photo, about you, your story, visibility as selectable cards) with a
  sticky save bar and a preview card of the saved profile. Investors edit it at
  `/investor/profile`, inside the investor portal's banner and tabs, instead of
  leaving the portal for `/account/profile`. Fields and save action unchanged.
- **How it works (revised):** the four flat step cards became a bento grid
  adapted from an owner-supplied features block, re-skinned with project tokens
  and inline icons (no shadcn `Card` or `lucide-react` added). Copy is the
  existing step and audience text only; illustrations are decorative.
- **Location map:** the detail page’s map is an expandable location card
  (`src/components/ui/expand-map.tsx`, adapted from an owner-supplied
  component) that springs open into the static map. It adds the
  `framer-motion` dependency, used by this component only; the tilt is off
  under `prefers-reduced-motion` and the toggle is a real `<button>`. The mock
  static-map palette was moved to the new tokens.
- Raw Tailwind palette colours in five admin/investor files were mapped to
  tokens.

## Consequences

- The owner's earlier instruction to remove header links (ADR-009) is reversed
  by this request; links point only at pages that exist.
- Signed-in header still shows exactly one portal link (ADR-016 holds).
- Compliance UI is unchanged: EPC badge on every card and detail page, EOI/RICS
  notices in the footer and auth shell, ROI still gated by
  `FINANCIAL_PROMOTIONS_REVIEWED`.
- Visual verification in a browser and the Playwright suite still need a run by
  the owner (the browser tool could not reach the local server).
- Amendment (2026-11-19): the landlord portal joins the buyer and investor
  portals on a photo-banner masthead (`/landlord` added to `OVERLAY_PREFIXES`)
  and the same card language. `VerifyButton` now uses the accent pill CTA
  everywhere it appears.
