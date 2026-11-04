# PropLink Admin Modernization — Phase A1: Secure Admin Shell Architecture

**Date:** October 8, 2026  
**Status:** Implemented & Verified  
**Phase:** A1 — Security Hardening & Shell Architecture  

---

## 1. SEC-01 Security Hardening: Fail-Closed Layout Gate

Prior to Phase A1, `src/app/admin/layout.tsx` performed a non-blocking check (`if (session?.user.role !== "ADMIN") return children;`) which allowed unauthenticated or non-admin requests to pass through the layout to child routes if child pages failed to invoke defense-in-depth authorization checks.

### Remediated Fail-Closed Flow:
1. **Proxy Middleware (`src/proxy.ts`)**: Sets `x-pathname` request header on incoming HTTP requests and optimistically gates `/admin/*`.
2. **Admin Layout Gate (`src/app/admin/layout.tsx`)**:
   - Inspects `headers().get("x-pathname")`.
   - If route is `/admin/login` or `/admin-login`, passes `<>{children}</>` without shell wrapping so the isolated admin sign-in page can render.
   - For all protected `/admin/*` routes: calls `auth()` to inspect the session.
   - **FAIL CLOSED:** If `session` is missing, `session.user.role !== "ADMIN"`, or `!session.user.active`, immediately triggers `redirect("/admin/login")`.
   - If user is verified active `ADMIN`, wraps `children` inside `<AdminShell userName={session.user.name} userEmail={session.user.email}>`.

---

## 2. Reusable Admin Shell Architecture

The Admin Shell is organized into modular layout components inside `src/components/admin/`:

```
AdminShell (Layout Container)
 ├── AdminSidebar (Fixed Left Navigation & Mobile Drawer)
 │    ├── Brand Area ("PropLink ADMIN OPERATIONS")
 │    ├── Grouped Nav (OPERATIONS, PLATFORM, COMMERCIAL, GOVERNANCE)
 │    └── Active Route Highlighting & Disabled State Badging ("Soon" / "Placeholder")
 └── Main Column
      ├── AdminHeader (Breadcrumb Trail + User Pill + Sign Out Form)
      └── Main Viewport Container (max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8)
```

---

## 3. Defense-in-Depth

Child pages retain their individual page-level authorization assertions (`await requirePageRole("ADMIN")` or `await requireRole("ADMIN")`), ensuring complete defense-in-depth:
1. Optimistic Proxy Gate (`proxy.ts`)
2. Fail-Closed Layout Boundary (`AdminLayout`)
3. Server Action / Page Authorization Assertion (`requirePageRole("ADMIN")`)
