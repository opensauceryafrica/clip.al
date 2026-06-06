# @clipal/ui

The Vercel-monochrome design system (§13). Zinc scale only, 1px borders, minimal
radii, near-zero shadows, Geist Sans/Mono. Primitives restyled from shadcn/Radix:
Button, Input, Textarea, Label, Card, Badge (status dot), Table, Tabs, Dialog,
DropdownMenu, Toast (`ToastProvider`/`useToast`), Skeleton, EmptyState, KeyValue,
CodeBlock, Spinner. `cn()` merges classes.

Components ship as TypeScript source (no build step). The consuming app's Tailwind
must `@source` this package's `src` so its classes are generated — see
`apps/web/app/globals.css`.
