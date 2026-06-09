# @clipal/safety

URL safety at submission and re-scan (§14.1). `validateDestination` does the
synchronous gate (length, scheme, embedded-credential, SSRF/IP-literal/internal-
host rejection, known-shortener rejection) and returns the host/eTLD+1/`sld`.

`checkBlocklist(host, etld1, sld)` evaluates the **unified blocklist** (§14.1,
§14.13): exact eTLD+1 **domain** entries and substring-of-host **keyword** entries
(former brand terms). Each entry has a policy — `reject` (refuse at submission) or
`flag` (allow but mark suspicious / queue for review). `reject` wins over `flag`.
`matchKeyword` is the pure substring heuristic (keyword in host, SLD not the
genuine site). It reads the Redis-cached blocklist (rebuilt from Postgres at boot
and on every admin mutation) and fails open.

`scanUrl`/`scanUrls` call Google Safe Browsing v4 (single + batches of 500 for the
rolling re-scan). eTLD+1 is computed with `tldts` (bundled public-suffix list).

## Every destination entry point MUST run checkBlocklist

`checkBlocklist()` is an async, post-`validateDestination` step. Any path that
accepts or mutates a link's `destination_url` must run it (with the same
`reject` → refuse / `flag` → suspicious-for-review semantics) or it's a bypass.
Wired today:

- `@clipal/shorten` `createLink` — new link submission.
- `apps/web` `editDestinationAction` — owner edits a link's destination.

TODO(@owner): the following Phase 2 entry points don't exist yet, but when they
land they MUST run `checkBlocklist` on the destination too:

- Bulk / CSV import of links.
- API-driven link creation and link update (public API tokens, §Phase 2).
- Any admin "create/edit link on behalf of a user" tooling.
- Custom-slug / branded-domain creation flows, if they accept a destination.

Note: anonymous-link claiming (re-assigning ownership after sign-in) does NOT
change `destination_url`, so it does not need the blocklist check.
