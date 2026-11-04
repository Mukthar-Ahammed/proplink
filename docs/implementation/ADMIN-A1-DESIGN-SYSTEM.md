# PropLink Admin Modernization — Phase A1: Design System Specification

**Date:** October 8, 2026  
**Status:** Implemented & Verified  
**Phase:** A1 — Design System & Primitives  

---

## 1. Brand Identity Preservation & Theme Tokens

The Admin Portal design system strictly preserves the authoritative PropLink UK product identity declared in `@theme` inside `src/app/globals.css`.

### Tokens & Semantic Mapping:

| Token Name | Hex Code | Visual Role | Usage in Admin UI |
| :--- | :--- | :--- | :--- |
| `primary` | `#1b1f1e` | Near-black ink | Primary button fills, main page titles, active sidebar items, header branding. |
| `secondary` | `#33403c` | Slate green-grey | Subtitles, navigation links, secondary table text, table header text. |
| `accent` | `#b4573c` | Terracotta ember | Single non-neutral brand accent. Hover states on primary buttons, active focus rings, breadcrumbs. |
| `surface` | `#f2f5f4` | Warm off-white | Page background canvas (`bg-surface/50`), hover backgrounds, table headers (`bg-surface`). |
| `pale` | `#e6efee` | Mist | Container fills, badge background tints, secondary hover states. |
| `brand` | `#0e4a55` | Deep petrol | Admin logo badge (`bg-brand text-white`), admin role tags (`bg-brand/10 text-brand`). |
| `success` | `#0a6640` | Deep green | Approved status pills, active account status (`bg-success/15 text-success`). |
| `warning` | `#a05a00` | Warm amber | Pending review pills, submitted queue status (`bg-warning/15 text-warning`). |
| `danger` | `#c0152a` | Crimson | Rejected status pills, deactivated account badges, destructive action buttons. |
| `body` | `#2f3733` | Warm dark grey | Primary text content across all administrative components. |
| `muted` | `#5f6b66` | Medium grey | Captions, metadata, breadcrumb separators, timestamp labels. |
| `line` | `#d5dcd9` | Light grey-green | Table gridlines, card borders (`border-line`), sidebar divider lines. |

---

## 2. Reusable Admin UI Primitives

### 2.1 Status System (`StatusBadge.tsx`)
Standardized status presentation across all domain enums:
```tsx
<StatusBadge status="APPROVED" />   // Success tone (green)
<StatusBadge status="PENDING" />    // Warning tone (amber)
<StatusBadge status="REJECTED" />   // Danger tone (crimson)
<StatusBadge status="DRAFT" />      // Neutral tone (slate)
```

### 2.2 Navigation Breadcrumbs (`AdminBreadcrumbs.tsx`)
Keyboard-navigable, accessible path trail rendering actual route hierarchy:
`Admin Portal / KYC Review Queue`

### 2.3 Page Masthead (`AdminPageHeader.tsx`)
Standardized page header supporting Title (`h1`), Subtitle (`p`), and optional action slot (e.g. Filter controls).

### 2.4 Data Grid Foundation (`DataTable.tsx`)
Standardized table layout with `bg-surface` uppercase header, `divide-y divide-line` body, responsive overflow container, and empty state handling.
