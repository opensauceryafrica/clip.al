# @clipal/observability

Server-side error tracking for self-hosted GlitchTip (Sentry SDK-compatible).
`initSentry('web' | 'worker')` is a no-op unless `SENTRY_DSN` is set, and logs one
`[boot]` line either way. A `beforeSend` scrubber redacts emails, auth codes,
session tokens (JWTs) and IPs, and drops cookies/headers/request bodies — no PII
leaves the process. `captureException(err, extra?)` reports handled errors;
unhandled rejections/exceptions are captured automatically. Web wires it via
`instrumentation.ts` (`register` + `onRequestError`); the worker inits at startup
and captures loop/scheduler errors.
