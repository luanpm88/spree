# Every target runs Rails inside Docker — you never need Ruby on your host.
# Local dev uses docker-compose.dev.yml (source bind-mounted, edits are live).
# Production uses docker-compose.prod.yml (prebuilt image from GHCR).
#
#   make up        first time? use `make setup` instead
#   make setup     one-shot: build, boot, create DB, seed, sample data, admin user
#   make help      list every target
#
# Docs: docs/DESIGN.md (what Spree is), docs/LOCAL.md (this file explained),
#       docs/DEPLOY.md (server + production).

DC        := docker compose -f docker-compose.dev.yml
EXEC      := $(DC) exec -T web
RUN       := $(DC) run --rm -T web
PORT      ?= 3000
ADMIN_EMAIL    ?= admin@b-teka.com
ADMIN_PASSWORD ?= spree123456

.DEFAULT_GOAL := help
.PHONY: help setup env build up down stop restart logs ps sh psql console \
        db-prepare db-migrate db-reset seed sample-data admin api-key \
        css css-watch mail test lint reset doctor

## ─── Getting started ────────────────────────────────────────────────────────

help: ## List every target
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: env build up db-prepare css sample-data admin api-key ## Full first-time setup (~10 min, mostly the image build)
	@echo
	@echo "──────────────────────────────────────────────────────────────"
	@echo " Spree is up:  http://localhost:$(PORT)/admin"
	@echo "   admin user: $(ADMIN_EMAIL) / $(ADMIN_PASSWORD)"
	@echo "   mail (all outgoing is captured, nothing is really sent):"
	@echo "               http://localhost:8025"
	@echo "   job queue:  http://localhost:$(PORT)/jobs  (spree / spree123)"
	@echo "──────────────────────────────────────────────────────────────"

env: ## Create .env with a generated SECRET_KEY_BASE (no-op if it exists)
	@if [ -f .env ]; then echo ".env already exists — leaving it alone"; else \
	  { echo "SECRET_KEY_BASE=$$(openssl rand -hex 64)"; \
	    echo "SPREE_PORT=$(PORT)"; \
	    echo "SPREE_DB_PORT=5433"; \
	    echo "MAILPIT_UI_PORT=8025"; \
	    echo "MAILPIT_SMTP_PORT=1025"; \
	    echo "RAILS_FORCE_SSL=false"; \
	    echo "RAILS_ASSUME_SSL=false"; \
	    echo "JOB_THREADS=10"; } > .env; \
	  echo "wrote .env"; fi

doctor: ## Check host prerequisites (Docker daemon, buildx, ports)
	@printf 'docker cli    : '; docker --version 2>/dev/null || echo MISSING
	@printf 'docker daemon : '; docker info --format '{{.ServerVersion}} ({{.NCPU}} cpu, {{.MemTotal}} bytes)' 2>/dev/null || echo 'NOT RUNNING — start Docker Desktop / OrbStack, or: colima start --cpu 4 --memory 8'
	@printf 'buildx plugin : '; docker buildx version 2>/dev/null || echo 'MISSING — brew install docker-buildx && mkdir -p ~/.docker/cli-plugins && ln -sfn /opt/homebrew/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx'
	@printf 'port $(PORT)     : '; (lsof -nP -iTCP:$(PORT) -sTCP:LISTEN >/dev/null 2>&1 && echo 'IN USE — set PORT=3001') || echo free
	@printf '.env          : '; ([ -f .env ] && echo present) || echo 'missing — run: make env'

## ─── Containers ─────────────────────────────────────────────────────────────

build: ## Build the dev image (rerun after Gemfile or Dockerfile changes)
	$(DC) build web

up: ## Start postgres + mailpit + web + admin_css watcher
	$(DC) up -d

down: ## Stop containers (keeps the database volume)
	$(DC) down

stop: down ## Alias for down

restart: ## Restart just the web container
	$(DC) restart web

logs: ## Tail web logs (make logs S=postgres for another service)
	$(DC) logs -f $(or $(S),web)

ps: ## Show container status
	$(DC) ps

## ─── Shells ─────────────────────────────────────────────────────────────────

sh: ## Bash shell inside the web container
	$(DC) exec web bash

console: ## Rails console
	$(DC) exec web bin/rails console

psql: ## psql shell on the dev database
	$(DC) exec postgres psql -U postgres spree_development

## ─── Database ───────────────────────────────────────────────────────────────
# These use `run --rm` (a throwaway container), not `exec`, so they work even
# when web is crash-looping. That matters on a fresh clone: Puma boots Solid
# Queue's supervisor in-process, and with no tables yet the supervisor raises
# and takes Puma down with it — so `exec` has nothing to attach to.

db-prepare: ## Create + migrate + seed the database (safe to re-run)
	$(RUN) bin/rails db:prepare

db-migrate: ## Run pending migrations
	$(RUN) bin/rails db:migrate

db-reset: ## DESTRUCTIVE: drop, recreate, migrate, seed
	$(RUN) bin/rails db:drop db:create db:migrate db:seed

seed: ## Load Spree's required seed data (countries, states, roles…)
	$(RUN) bin/rails db:seed

sample-data: ## Load demo catalog, customers, orders AND the wholesale/B2B demo
	$(RUN) bin/rails spree:load_sample_data

admin: ## Create an admin user (override ADMIN_EMAIL / ADMIN_PASSWORD)
	$(RUN) -e EMAIL=$(ADMIN_EMAIL) -e PASSWORD=$(ADMIN_PASSWORD) \
	  bin/rails spree:cli:create_admin || \
	  echo "  (already exists — that's fine)"

api-key: ## Print the storefront publishable API key
	@$(RUN) bin/rails spree:cli:ensure_api_key

## ─── Assets ─────────────────────────────────────────────────────────────────

css: ## Build Spree Admin's Tailwind CSS once (required, see docs/LOCAL.md)
	$(EXEC) bin/rails spree:admin:tailwindcss:build

css-watch: ## Rebuild admin CSS on change in the foreground
	$(DC) exec web bin/rails spree:admin:tailwindcss:watch

## ─── Checks ─────────────────────────────────────────────────────────────────

mail: ## Send a test email, then show what Mailpit captured
	$(EXEC) bin/rails runner script/smoke_mail.rb $(TO)
	@echo "--- Mailpit inbox (http://localhost:8025) ---"
	@curl -s http://localhost:$(or $(MAILPIT_UI_PORT),8025)/api/v1/messages \
	  | python3 -c "import sys,json;d=json.load(sys.stdin);print('messages:',d.get('messages_count'));[print(' -',m['Subject'],'->',[x['Address'] for x in m['To']]) for m in d.get('messages',[])[:5]]"

test: ## Run the RSpec suite
	$(EXEC) bundle exec rspec

lint: ## Rubocop
	$(EXEC) bin/rubocop

reset: ## DESTRUCTIVE: remove containers AND volumes, then set up from scratch
	$(DC) down -v
	$(MAKE) setup
