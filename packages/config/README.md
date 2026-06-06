# @clipal/config

Boot-time environment validation (zod) and shared, secret-free constants. `env`
is parsed and frozen once at module load; importing it from a client component is
forbidden because it reads secrets. `constants` (slug alphabet, reserved slugs,
known shorteners, brand terms, auth/interstitial tunables) is safe to import
anywhere. Rate-limit windows are pre-resolved in `limits`.
