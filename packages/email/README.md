# @clipal/email

Transactional email via Resend (§19) — the only external SaaS in Phase 1.
Monochrome React Email templates: verification code, welcome (migrated abbrefy
user), account suspended, link disabled (safety). `sendVerificationCode` logs the
code to the console in development when no `RESEND_API_KEY` is set, so the local
sign-in flow works without a Resend account.
