# clip.al — agent guide

A self-hosted URL shortener / link manager. pnpm workspace; Next.js 15 (App
Router, Node runtime) in `apps/web`; a loop-based worker in `apps/worker`;
shared packages under `packages/*` (config, db, cache, ch, auth, safety,
shorten, email, ui, observability). Postgres + Redis + ClickHouse + MinIO,
fronted by Caddy, orchestrated via `infra/docker-compose.yml`.

## UI / design system rules (MANDATORY, going forward)

Every UI component and page **must** follow these. Treat them as build rules, not
suggestions.

1. **Dark mode first.** Dark is the default and the primary design target. The
   `<html>` element carries the `dark` class and Tailwind's `dark:` variant is
   **class-based** (`@custom-variant dark` in `apps/web/app/globals.css`), not
   OS-`prefers-color-scheme`. Design and review every component in dark first;
   light is the secondary variant, kept working but never the priority.
2. **ShadCN + design tokens.** Use the ShadCN-style CSS variable token layer in
   `globals.css` — `bg-background`, `text-foreground`, `bg-card`,
   `text-muted-foreground`, `border-border`, `border-input`, `bg-primary`,
   `bg-secondary`, `bg-accent`, `bg-destructive`, `ring-ring`, etc. New
   components consume these tokens, NOT hardcoded `bg-white dark:bg-zinc-900`
   pairs. (Legacy pages still use raw zinc utilities; migrate opportunistically
   when you touch them.) When using a shadcn/ui primitive, never ship it in its
   generic default state — match the radii, color and motion below.
3. **Design taste.** Before building or refreshing UI, load the
   `design-taste-frontend` skill and follow it. Non-negotiables it encodes:
   - **No "AI purple/blue"** glows or neon gradients. Neutral zinc base, at most
     **one** desaturated accent.
   - **Never pure black** (`#000`). Use zinc-950 / token `--background`.
   - **Geist** (sans + mono) only; serif is banned in app/dashboard UI.
   - **Tactile feedback** on interactive elements (`active:translate-y-px` /
     `scale-[0.98]`), real hover/focus/disabled states, and proper empty /
     loading (skeleton) / error states.
   - Tailwind v4 (`@tailwindcss/postcss`); CSS Grid over flex-percentage math;
     animate only `transform`/`opacity`.
4. **Aesthetic:** Vercel-style monochrome — zinc scale, 1px borders, minimal
   radii, restrained shadows (tinted, never neon). Icons: `lucide-react`,
   consistent stroke width.

Shared primitives live in `packages/ui/src/*` and are the canonical
implementations — prefer extending them over re-styling per page.

## Conventions

- Strict TS (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`). Internal packages export `.ts` source and are
  transpiled in-place (`transpilePackages`); no build step.
- After changes: `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test`. For UI/app
  changes, also rebuild the web image and confirm it boots healthy.
- Conventional commits; commit only when asked. End commit messages with the
  `Co-Authored-By` trailer.
- Public URLs/cookies derive from `APP_URL`, never the request `Host`.
