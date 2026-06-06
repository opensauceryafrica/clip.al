# @clipal/safety

URL safety at submission and re-scan (§14.1). `validateDestination` does the
synchronous gate (length, scheme, embedded-credential, SSRF/IP-literal/internal-
host rejection, known-shortener rejection) and returns the host/eTLD+1/`sld`.
`isBlockedDomain` checks the Redis-backed eTLD+1 blocklist. `checkBrandTerms`
runs the trademark-lookalike check against the Redis-cached `flagged_brand_terms`
(`flag` = soft, non-blocking review; `reject` = hard block) — see `matchBrandTerm`
for the pure heuristic. `scanUrl`/`scanUrls` call Google Safe Browsing v4 (single
+ batches of 500 for the rolling re-scan). eTLD+1 is computed with `tldts`
(bundled public-suffix list).

## Brand-term check: every destination entry point MUST run it

`checkBrandTerms()` is an async, post-`validateDestination` step. Any code path
that accepts or mutates a link's `destination_url` must run it (with the same
`flag` → suspicious-for-review / `reject` → `brand_blocked` semantics) or it's a
trivial bypass of the brand-term system. Wired today:

- `@clipal/shorten` `createLink` — new link submission.
- `apps/web` `editDestinationAction` — owner edits a link's destination.

TODO(@owner): the following Phase 2 entry points don't exist yet, but when they
land they MUST run `checkBrandTerms` on the destination too (this list is the
checklist):

- Bulk / CSV import of links.
- API-driven link creation and link update (public API tokens, §Phase 2).
- Any admin "create/edit link on behalf of a user" tooling.
- Custom-slug / branded-domain creation flows, if they accept a destination.

Note: anonymous-link claiming (re-assigning ownership after sign-in) does NOT
change `destination_url`, so it does not need the brand check.
