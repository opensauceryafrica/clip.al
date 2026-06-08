ALTER TABLE "links" ADD COLUMN "previous_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "links_previous_codes_gin" ON "links" USING gin ("previous_codes");