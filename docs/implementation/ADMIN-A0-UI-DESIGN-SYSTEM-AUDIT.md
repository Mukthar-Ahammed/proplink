# PropLink Admin Audit — Phase A0: UI Design System & Component Audit

**Date:** October 8, 2026  
**Status:** Design System Inspection Complete  
**Scope:** Brand Tokens, Design Rules, Components & UI/UX Usability Assessment  

---

## 1. Brand Tokens & CSS Architecture

PropLink UK utilizes Tailwind CSS v4 with brand design tokens declared in `@theme` inside `src/app/globals.css`. 

### Official Color Tokens:
- `--color-primary`: `#1b1f1e` (Near-black ink — used for headers, primary buttons, main headings)
- `--color-secondary`: `#33403c` (Slate green-grey — used for secondary text, tab links)
- `--color-accent`: `#b4573c` (Terracotta ember — single non-neutral brand accent, hover state for primary action)
- `--color-surface`: `#f2f5f4` (Warm off-white ground for tables and card fills)
- `--color-pale`: `#e6efee` (Mist — background tint for secondary buttons and subtle containers)
- `--color-brand`: `#0e4a55` (Deep petrol — full-bleed marketing masthead ground & security portal accent)
- `--color-success`: `#0a6640` (Deep green — approved status, active badges)
- `--color-warning`: `#a05a00` (Warm amber — pending review status, caution badges)
- `--color-danger`: `#c0152a` (Crimson — rejected status, deactivation buttons, error alerts)
- `--color-body`: `#2f3733` (Warm dark grey — primary body copy)
- `--color-muted`: `#5f6b66` (Medium grey — captions, labels, metadata)
- `--color-line`: `#d5dcd9` (Light grey-green — table gridlines, card borders)

### Typography & Fonts:
- `--font-sans`: Figtree (`var(--font-figtree)`), system-ui, sans-serif.
- `--font-display`: Figtree (`var(--font-figtree)`), sans-serif (separated from body by scale & weight).

---

## 2. Existing UI Primitives (`src/components/ui/*`)

| Component | File | Styling Pattern | Purpose |
| :--- | :--- | :--- | :--- |
| **Button** | `button.tsx` | `VARIANTS`: `primary` (`bg-primary text-white hover:bg-accent`), `secondary` (`border-line bg-pale`), `outline`, `danger` (`bg-danger`), `ghost`. | Reusable action button across all surfaces. Primary button uses **ink (`#1b1f1e`)**, NOT accent. |
| **Badge & EpcBadge** | `badge.tsx` | `tone`: `neutral`, `success`, `warning`, `danger`, `intel`, `brand`. | Status pills (`ACTIVE`, `PENDING`, `REJECTED`, `APPROVED`). |
| **DataTable** | `data-table.tsx` | `table` with `bg-surface` header (`text-xs uppercase text-muted`) and `divide-y divide-line` body. | Standard tabular data display. |
| **Modal** | `modal.tsx` | Fixed overlay with backdrop blur, white container (`rounded-xl border border-line shadow-xl`), close button. | Dialog for review forms and confirmation step. |
| **Toast** | `toast.tsx` | Floating alert container bottom-right with success/danger tone styling. | Real-time feedback for async admin actions. |
| **KycPill** | `src/components/layout/KycPill.tsx` | Inline status badge (`APPROVED`, `PENDING`, `REJECTED`, `NOT_STARTED`). | Displays profile KYC authorization level. |

---

## 3. Component Ownership Classification

- **Shared Components (Public Site & Admin):**
  - `Button`, `Badge`, `DataTable`, `Modal`, `Toast`, `Input`, `Select`, `MultiSelect`, `ProgressBar`.
  - `SiteHeader`, `ChromeGate`.
- **Admin-Exclusive Components:**
  - `src/app/admin/layout.tsx` (Admin portal navigation header).
  - `src/app/admin/login/AdminLoginForm.tsx` (Admin security login form).
  - `src/components/admin/ModerationQueue.tsx` (Listing moderation workspace).
  - `src/app/admin/kyc/KycQueueClient.tsx` (KYC queue workspace & document drawer).

---

## 4. Identified UI/UX Usability Problems

1. **Inconsistent Component Systems across Admin Pages:**
   - `/admin` (Users) uses `<DataTable>` with server action forms.
   - `/admin/moderation` uses `<DataTable>` + `<Modal>` with client fetch.
   - `/admin/kyc` uses a custom hardcoded `<table>` in `KycQueueClient.tsx` with Tailwind utility classes (`bg-blue-600`, `bg-green-600`), ignoring the standard `<DataTable>` and `@theme` brand tokens (`bg-primary`, `bg-accent`)!
2. **Missing Workspace Split-Screen:**
   - Reviewing KYC documents requires clicking "Secure View / Preview", opening a new browser tab. Moderation modal stacks all property data vertically, requiring excessive scrolling.
3. **Lack of SLA Timers & Urgency Indicators:**
   - Submissions show raw submission dates without highlighting items waiting > 24 or 48 hours.
4. **Placeholder Navigation Links:**
   - Admin header includes `/admin/fees` and `/admin/ads` which lead to dead-end text strings.
5. **No Responsive Layout Adaptability:**
   - Tables overflow horizontally on mobile/tablet without sticky column controls.
