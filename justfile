# Quality gate — see adr/2026-07-02-quality-gate-contract-justfile.md.
# `just check` is the single gate command used by AGENTS.md, CI, and the reviewer.

# Run the whole gate.
check: format lint typecheck test build

# Format code.
format:
    npx prettier --write .

# Lint.
lint:
    npx eslint . --max-warnings 0

# Type-check.
typecheck:
    npx tsc --noEmit

# Tests.
test:
    npx vitest run

# Build the unpacked extension into dist/.
build:
    npx vite build
