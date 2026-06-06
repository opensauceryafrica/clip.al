# @clipal/shorten

Link creation. `generateSlug` produces 7-char base62 codes (nanoid). `createLink`
runs the full submission pipeline — `@clipal/safety` validation → Redis blocklist
→ Google Safe Browsing → insert with `ON CONFLICT DO NOTHING` collision retry
(§9). Malicious/blocked/private destinations are hard-rejected; trademark
lookalikes are created live but flagged to `audit_log` for review (§14.13).
