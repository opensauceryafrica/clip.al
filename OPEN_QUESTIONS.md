# Open questions for @owner

The Phase 1 prompt (§22) asks me to flag ambiguity rather than invent behavior or
legal text. Each item below is also marked with a `TODO(@owner)` comment at the
relevant place in the code. Answer in one pass and I'll wire the decisions in.

## Legal copy (blocking for launch, not for build)
- [ ] **TOS / Privacy / AUP / DMCA** — I've shipped defensible *placeholder* drafts
  marked `TODO(@owner)` at `apps/web/app/(marketing)/(legal)/*`. Do NOT treat them
  as reviewed legal text. The prompt says not to invent final legal copy. Please have
  these reviewed by counsel and replace. Key blanks: legal entity name, jurisdiction,
  DMCA agent name + physical address + email, data-retention specifics, contact email.

## URL safety / abuse policy
- [ ] **Reserved slugs** — seeded the list from §7 plus obvious additions. Confirm the
  final set (esp. brand/handle squatting: `whatsapp`, `paypal`, `x`, etc.).
- [ ] **Brand terms (`flagged_brand_terms`)** — seeded a starter list (paypal, apple,
  google, microsoft, amazon, meta, facebook, instagram, netflix, binance, coinbase,
  metamask, etc.). Confirm the canonical list and whether substring matches on
  destination hostnames (e.g. block `paypal-login.com`) should hard-reject or just
  flag for review. Currently: hard-reject on exact eTLD+1 in blocklist, flag-for-review
  on brand substring. Confirm.
- [ ] **Known-shortener blocklist** — refusing to shorten other shorteners (bit.ly,
  t.co, tinyurl, goo.gl, ow.ly, is.gd, buff.ly, rebrand.ly, cutt.ly, t.ly...).
  Confirm the list; confirm whether to also block clip.al-on-clip.al loops (currently
  yes — a clip.al destination is rejected).

## Infra / ops
- [ ] **MaxMind license key** — the prompt's GeoLite2 monthly refresh needs a license
  key, which wasn't in the env list. Added `MAXMIND_LICENSE_KEY` (optional). If unset,
  geo is best-effort and the worker logs `country="ZZ"`. Provide a key or pre-seed the
  `.mmdb` files in `GEOIP_DIR`.
- [ ] **Wildcard TLS** — `*.clip.al` needs a DNS-01 challenge. Which DNS provider?
  (Caddyfile has a commented Cloudflare example.) Not needed until Phase 2 custom
  subdomains, but the cert won't issue for the wildcard until configured.

## Product behavior
- [ ] **Anonymous "claim within 24h"** — the landing CTA offers anon users to claim a
  link by registering. Implemented: an anon link stores `creator_ip`; a freshly
  signed-in user can claim *unowned* links they created from the same browser via a
  signed claim token set at creation time (24h TTL cookie). Confirm this is the desired
  mechanism vs. e.g. emailing a claim link.
- [ ] **bit.ly-style destination preview** (§22) — should the interstitial fetch and
  show a thumbnail/title of the destination? Deferred; not built. Confirm if wanted in
  a later phase (has SSRF implications — would need the same private-CIDR guards).
- [ ] **Abbrefy export schema** — coded defensively against
  `{ email, legacy_id, created_at }` and skip-on-missing. If the real export differs,
  point me at a sample and I'll adjust the normalizer in `scripts/migrate-abbrefy.ts`.
