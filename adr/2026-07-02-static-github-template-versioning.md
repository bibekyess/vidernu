---
title: Distribute as a static GitHub template with a TEMPLATE_VERSION marker
date: 2026-07-02
status: Accepted
supersedes:
superseded-by:
---

# 2026-07-02 — Distribute as a static GitHub template with a TEMPLATE_VERSION marker

## Context

The template must be adoptable today and evolvable later. Derived repos need to know which
baseline they came from so a future upgrade path (e.g. a Copier/Cookiecutter migration) can
reason about what changed. A full templating engine now would add tooling and a variable
syntax the v1 scope does not need, and would complicate the "clone and go" story.

## Decision

We will distribute v1 as a **static GitHub template repository** (used via GitHub's "Use
this template"), and record the baseline in a root `TEMPLATE_VERSION` file plus a
`CHANGELOG.md` whose first entry documents the v1 baseline. No Copier/Cookiecutter in v1;
the version marker exists specifically to enable that migration later without regret.

## Alternatives considered

- **Copier / Cookiecutter now** — rejected for v1: adds a templating engine, variable
  interpolation, and update tooling that the current scope does not require; deferred to a
  possible v2 that the `TEMPLATE_VERSION` marker is designed to enable.
- **No version marker** — rejected: derived repos could not tell which baseline they came
  from, making any future migration a guess.

## Consequences

- Adoption is trivial ("Use this template" / clone); no engine to learn.
- `TEMPLATE_VERSION` + `CHANGELOG.md` must be kept current as the template evolves.
- A later Copier/Cookiecutter migration can key off the recorded baseline. This ADR would be
  superseded by that migration's ADR when it lands.
- The two new deterministic guard hooks (`protect-primary-checkout.sh`, `secret-scan.sh`)
  ship as part of this static template; they extend the existing hook pattern and need no
  separate ADR.
