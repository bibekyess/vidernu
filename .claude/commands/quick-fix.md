---
description: Fast-path for trivial fixes — skips spec and plan, runs implement + review only.
---

**Trivial-change fast-path.** Use only when the fix is localized with no new dependency,
interface, or schema change, and nothing that would trigger an ADR. Anything outside that
boundary must use the full pipeline (`/spec` → `/plan` → `/implement` → `/review`).

Steps (spec and plan stages are intentionally skipped):

1. Confirm the change is trivial per the boundary above. If in doubt, use the full pipeline.
2. Create a feature worktree if one does not exist:
   `git worktree add .claude/worktrees/<slug> -b feat/<slug>`
3. Spawn `implementation-engineer` directly with the worktree path, the change description,
   and a note that this is a trivial fast-path (no spec/plan files to read).
4. The engineer implements, runs `just check`, commits, pushes, and opens a PR.
5. Spawn `code-reviewer` on the PR; loop on `REQUEST_CHANGES` until APPROVED.

Return the PR URL once open.
