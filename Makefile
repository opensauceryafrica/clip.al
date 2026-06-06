# clip.al — operator commands. `make help` lists everything.
# All targets assume a populated .env at the repo root.

SHELL := /bin/bash
COMPOSE := docker compose -f infra/docker-compose.yml --env-file .env
COMPOSE_PROD := docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env
COMPOSE_OBS := docker compose -f infra/docker-compose.yml -f infra/docker-compose.observability.yml --env-file .env
BACKUP_DIR := backups

.DEFAULT_GOAL := help

.PHONY: help up up-prod up-obs down logs ps build restart psql redis-cli ch-client \
        migrate migrate-create migrate-push seed import-abbrefy health backup restore clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Start the core stack (detached)
	$(COMPOSE) up -d --build

up-prod: ## Start with production overlay (resource limits, log rotation, web x2)
	$(COMPOSE_PROD) up -d --build

up-obs: ## Start core stack + GlitchTip observability overlay
	$(COMPOSE_OBS) up -d --build

down: ## Stop the stack (keeps volumes)
	$(COMPOSE) down

logs: ## Tail logs for all services (S=web to scope to one service)
	$(COMPOSE) logs -f --tail=200 $(S)

ps: ## Show service status
	$(COMPOSE) ps

build: ## Rebuild web + worker images
	$(COMPOSE) build web worker

restart: ## Restart a service: make restart S=web
	$(COMPOSE) restart $(S)

psql: ## Open a psql shell on the app database
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

redis-cli: ## Open redis-cli
	$(COMPOSE) exec redis redis-cli

ch-client: ## Open the ClickHouse client
	$(COMPOSE) exec clickhouse clickhouse-client --database "$${CLICKHOUSE_DATABASE:-clipal}"

migrate: ## Apply pending Drizzle migrations (runs in the web container)
	$(COMPOSE) exec web pnpm --filter @clipal/db migrate

migrate-create: ## Generate a new migration from schema changes (run locally): make migrate-create
	pnpm --filter @clipal/db generate

migrate-push: ## Push schema directly without a migration file (dev only)
	$(COMPOSE) exec web pnpm --filter @clipal/db push

seed: ## Create the initial admin user from INITIAL_ADMIN_EMAIL
	$(COMPOSE) exec web pnpm --filter @clipal/web exec tsx ../../scripts/seed-admin.ts

import-abbrefy: ## One-shot import of abbrefy users from ABBREFY_EXPORT_PATH
	$(COMPOSE) exec web pnpm --filter @clipal/web exec tsx ../../scripts/migrate-abbrefy.ts

health: ## Curl the app health endpoint
	@curl -fsS http://localhost:3000/api/health 2>/dev/null | python3 -m json.tool || \
		$(COMPOSE) exec web wget -qO- http://localhost:3000/api/health

backup: ## Dump Postgres (gzip) and mirror MinIO into ./backups/<timestamp>/
	@set -euo pipefail; \
	stamp=$$(date +%F-%H%M%S); \
	dir="$(BACKUP_DIR)/$$stamp"; \
	mkdir -p "$$dir"; \
	echo "→ Postgres dump"; \
	$(COMPOSE) exec -T postgres sh -c 'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"' | gzip > "$$dir/postgres.sql.gz"; \
	echo "→ MinIO mirror"; \
	source .env; \
	$(COMPOSE) run --rm --no-deps -T minio-init /bin/sh -c "mc alias set local http://minio:9000 $$MINIO_ROOT_USER $$MINIO_ROOT_PASSWORD >/dev/null && mc mirror --overwrite local/$$S3_BUCKET /tmp/out" || true; \
	echo "✓ Backup written to $$dir (MinIO objects mirrored inside the minio-init container volume; see README for off-box sync)"

restore: ## Restore Postgres from a dump: make restore FILE=backups/.../postgres.sql.gz
	@test -n "$(FILE)" || (echo "Usage: make restore FILE=backups/<stamp>/postgres.sql.gz" && exit 1)
	@echo "Restoring $(FILE) into Postgres…"
	@gunzip -c "$(FILE)" | $(COMPOSE) exec -T postgres sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

clean: ## DANGER: stop stack and delete all volumes (data loss)
	$(COMPOSE) down -v
