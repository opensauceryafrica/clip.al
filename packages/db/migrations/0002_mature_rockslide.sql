CREATE TYPE "public"."block_match" AS ENUM('domain', 'keyword');--> statement-breakpoint
ALTER TABLE "blocked_domains" ADD COLUMN "match" "block_match" DEFAULT 'domain' NOT NULL;--> statement-breakpoint
ALTER TABLE "blocked_domains" ADD COLUMN "policy" "brand_term_policy" DEFAULT 'reject' NOT NULL;--> statement-breakpoint
CREATE INDEX "blocked_domains_match_idx" ON "blocked_domains" USING btree ("match");--> statement-breakpoint
-- Data migration: fold flagged_brand_terms into the unified blocklist as keyword
-- entries (idempotent). The flagged_brand_terms table is left in place (deprecated).
INSERT INTO "blocked_domains" ("domain", "match", "policy", "reason", "added_by", "created_at")
SELECT "term", 'keyword', "policy", 'brand', "added_by", "created_at"
FROM "flagged_brand_terms"
ON CONFLICT ("domain") DO NOTHING;