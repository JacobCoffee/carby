.DEFAULT_GOAL := help

BUN ?= bun
ARGS ?=
TESTS ?=

.PHONY: help install serve build start migrations migrate clean lint lint-fix fmt fmt-check typecheck test ci

help: ## Display this help text
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

##@ Development

install: ## Install dependencies from the lockfile
	$(BUN) install --frozen-lockfile

serve build start migrations migrate lint lint-fix fmt fmt-check typecheck test: install

serve: ## Set up a local Postgres if needed and start the dev server with local sign-in (port 5173)
	$(BUN) run dev $(ARGS)

build: ## Build the application
	$(BUN) run build $(ARGS)

start: ## Serve an existing build locally with local sign-in (port 8787)
	$(BUN) run start $(ARGS)

migrations: ## Generate Drizzle migrations from the schema
	$(BUN) run db:generate $(ARGS)

migrate: ## Apply pending migrations against DATABASE_URL (must already be set)
	$(BUN) run migrate $(ARGS)

clean: ## Remove build output and caches; keep dependencies and local data
	rm -rf .next .vinext dist out coverage node_modules/.vite
	rm -f tsconfig.tsbuildinfo

##@ Code Quality

lint: ## Check code with Oxlint, including type-aware rules
	$(BUN) run lint $(ARGS)

lint-fix: ## Apply Oxlint automatic fixes
	$(BUN) run lint:fix $(ARGS)

fmt: ## Format code with Oxfmt
	$(BUN) run fmt $(ARGS)

fmt-check: ## Check formatting with Oxfmt without writing files
	$(BUN) run fmt:check $(ARGS)

typecheck: ## Check TypeScript with tsc without emitting files
	$(BUN) run typecheck

test: ## Run tests with Bun (optionally TESTS=./tests/name.test.mjs)
	$(BUN) run test $(ARGS) $(TESTS)

ci: ## Run lint, format check, type checking, and tests in order
	$(MAKE) lint
	$(MAKE) fmt-check
	$(MAKE) typecheck
	$(MAKE) test
