# @clipal/auth

Passwordless auth primitives (§8). `generateCode`/`hashCode`/`verifyCode` —
6-digit codes, argon2id (time=3, 64MiB, p=4), never plaintext. `signSession`/
`verifySession` — HS256 JWT (sub=user, sid=session JTI) via jose.
`createSession`/`validateSession`/`revokeSession`/`revokeAllSessions` — session
rows + a Redis revocation denylist + a 60s user cache, with throttled
`last_seen_at` writes. `verifyTurnstile` — server-side CAPTCHA verification.

The sign-in/verify *flow* (rate limits, abbrefy deflection, email, cookie) lives
in the web app's auth server actions; this package is the reusable mechanism.
