# ADR-077: Loading states — route loaders and pending submit buttons

**Status:** Accepted (owner-requested, 2026-11-19)
**Date:** 2026-11-19

## Context

The owner asked for a visible loader wherever the app is loading. Before this,
no route had a `loading.tsx`, so navigating to a data-heavy page left the old
page on screen with no feedback. Plain server-component forms
(`<form action={serverAction}>`) and GET filter forms had no pending state, so a
slow submit looked like a dead button and could be pressed twice. Client forms
built with `useActionState`/`useTransition` already showed a pending label.

## Decision

- **One spinner**: `src/components/ui/spinner.tsx` (`Spinner`). It draws in
  `currentColor`, so it suits filled and outline buttons and pages without
  hardcoded colours.
- **Route loaders**: `src/components/ui/page-loader.tsx` (`PageLoader`) is
  rendered by a `loading.tsx` in each portal (`admin`, `agent`, `investor`,
  `landlord`, `buy`, `solicitor`) and in `messages`. These sit below the portal
  layout, so the portal header and sub-nav stay on screen while the page loads.
  Each top-level public folder re-exports `src/components/ui/SiteLoading.tsx`.
  (Amended 2026-11-20: there is no root `src/app/loading.tsx` any more. A root
  boundary blanked the whole page whenever the top-level folder changed, so a
  portal tab leading to `/messages` flashed a bare spinner screen; ADR-081.)
- **Submit buttons**: `src/components/ui/submit-button.tsx` (`SubmitButton`,
  client) reads `useFormStatus()`. It shows the spinner and disables every
  button in the form while it submits. When a form has several named buttons,
  only the one that was pressed shows the spinner. Server components use it
  as a drop-in replacement for a raw `<button>` inside a server-action form.
- **GET filter/search forms** now use `next/form` (`<Form action="">`). This
  gives a client-side navigation that `useFormStatus` can track and that shows
  the route loader. The URL and query parameters are the same as before.
- `Button` gains a `loading` prop. `ActionButton` shows the spinner next to its
  pending label.

## Consequences

- New server-component forms should use `SubmitButton`, and new GET forms
  should use `next/form`, rather than a raw `<button>`/`<form>`.
- Client forms keep their own `pending` handling. They can pass
  `loading={pending}` to `Button` or render `<Spinner />` next to the label.
- A portal layout still does its own auth/data work, so the first navigation
  _into_ a portal shows the site-wide loader. Moves within a portal show the
  portal one.
