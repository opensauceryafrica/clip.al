# @clipal/safety

URL safety at submission and re-scan (§14.1). `validateDestination` does the
synchronous gate (length, scheme, embedded-credential, SSRF/IP-literal/internal-
host rejection, known-shortener rejection, trademark-lookalike soft flag).
`isBlockedDomain` checks the Redis-backed eTLD+1 blocklist. `scanUrl` /`scanUrls`
call Google Safe Browsing v4 (single + batches of 500 for the rolling re-scan).
eTLD+1 is computed with `tldts` (bundled public-suffix list).
