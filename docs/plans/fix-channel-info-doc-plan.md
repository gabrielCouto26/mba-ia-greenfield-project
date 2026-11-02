# Execution Plan — Fix "channel info" in `GET /videos/:publicId` documentation

> Source research: `docs/research/fix-channel-info-doc-research.md`
> Branch: `fix/channel-info` · Date: 2026-11-02 · Type: documentation-only correction

---

# 1. INTENTION

- **Assumed role:** Backend Documentation Maintainer / Technical Writer (NestJS backend).
- **Strategic objective:** Make the prose route documentation match the real API contract. `GET /videos/:publicId` is documented as returning "channel info", but `VideosService.findByPublicId` returns no channel data. The documentation — not the code — is wrong, so the fix aligns the docs to the implementation.
- **Architectural mindset:** The source of truth for the API contract is `openapi.json` (generated from the controller `@ApiResponse` decorators) and the Phase 03 plan — both already correct and listing exactly the 7 real fields. Prose summary tables must follow that truth, never diverge from it.
- **Quality bar:** Zero `"channel info"` occurrences describing this route anywhere in the repo after the change; zero production code touched; the real field list (`id, public_id, title, status, duration, thumbnail_url, created_at`) stated consistently across all docs.

---

# 2. SCOPE

## Technical stack involved
- Markdown documentation (`nestjs-project/CLAUDE.md`).
- JSON state snapshot (`state.local.json`) — already corrected during the state-local regeneration on 2026-11-02; this plan only verifies it.
- No TypeScript, no build, no runtime, no database, no migration.

## Files to modify
| File | Line | Action |
|---|---|---|
| `nestjs-project/CLAUDE.md` | 170 | **Modify.** Replace `Get video metadata, status, channel info, thumbnail URL` with a description of the real 7-field return. |
| `state.local.json` | — | **Verify only** (already corrected): the `endpointsAndAPIs.implemented` line for `GET /videos/:publicId` already lists the real fields and states "Does NOT return channel data". No further edit expected. |

## Files explicitly NOT changed (already correct — verify, do not touch)
- `nestjs-project/openapi.json` — 200 response already lists the 7 fields, no channel.
- `nestjs-project/src/videos/services/videos.service.ts` — `findByPublicId` is the source of truth; stays as is.
- `nestjs-project/src/videos/controllers/videos.controller.ts` — `@ApiResponse` schema already correct.
- `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.9 and API Contract already list the 7 fields.

## Execution stages

### Stage 1 — Correct the canonical prose route table
- **What:** In `nestjs-project/CLAUDE.md:170` (Videos Module → API Endpoints table), replace the Description cell `Get video metadata, status, channel info, thumbnail URL` with wording that reflects the real return, e.g.:
  `Get public video info: id, public_id, title, status, duration, thumbnail_url, created_at`
- **How validated:** Re-read the edited line; confirm it no longer contains `channel info` and lists the 7 fields matching `openapi.json`.
- **Gate:** Do not proceed to Stage 2 until the line is confirmed changed and no other cell in the same file repeats the phrase.

### Stage 2 — Verify the state snapshot
- **What:** Confirm `state.local.json` `endpointsAndAPIs.implemented` entry for `GET /videos/:publicId` already reads the real fields with the "Does NOT return channel data" note (corrected 2026-11-02). No edit expected; if any stale `channel info` describing the route's return remains, correct it.
- **How validated:** Inspect the specific line; ensure it matches the real contract.
- **Gate:** Do not proceed until the snapshot is confirmed consistent with Stage 1 wording.

### Stage 3 — Repository-wide consistency check
- **What:** Run the verification grep and confirm the only remaining `channel info` matches are the intentional meta-references (the research dossier and this plan describing the issue, and `state.local.json` passages that describe the fix) — never a line that *describes the route's actual return* as including channel info.
- **How validated:** `grep -rn "channel info" --include="*.md" --include="*.json" --include="*.ts" . | grep -v node_modules` reviewed line-by-line; `nestjs-project/CLAUDE.md:170` must no longer appear.
- **Gate:** Final gate before declaring done.

## Testing strategy
- No automated test suite applies (no code change). The factual verification is the grep review plus a visual diff of the two documentation lines against `openapi.json`.
- Optional sanity check (not a gate): `cd nestjs-project && npm run openapi:export` to reconfirm the generated contract still has no channel field — expected unchanged since no controller code is touched.

## Expected outputs
- `nestjs-project/CLAUDE.md:170` describing the real 7-field return.
- `state.local.json` confirmed consistent.
- A clean grep review showing no route-description line claims "channel info".
- This plan committed under `docs/plans/`.

---

# 3. RESTRICTIONS

- **Documentation only.** No `.ts` file may be modified. If any `.ts` change seems necessary, the scope is wrong — stop and re-scope (returning channel data would be a new feature, not a doc fix).
- **One scope at a time** (project `CLAUDE.md` → Scope Limits). Do NOT fix the SI-03.7 vs SI-03.9 numbering mismatch in `phase-03-videos.md` here — it is a separately registered technical debt in `state.local.json` with its own future `docs/*` commit.
- **No cosmetic drive-by edits** (reformatting, reordering, renaming) alongside this change.
- **Do not alter `openapi.json`, the controller, the service, or the phase-03 plan** — they are already correct; changing them would introduce divergence, not remove it.
- **Git:** work stays on `fix/channel-info`; never commit to `main`. Follow Git Flow for the eventual merge. No restricted commands (`git push`, `reset`, `rebase`, etc.).

---

# 4. SUCCESS CRITERIA

1. `nestjs-project/CLAUDE.md:170` no longer contains `channel info` and lists exactly `id, public_id, title, status, duration, thumbnail_url, created_at`.
2. No documentation line anywhere in the repo describes `GET /videos/:publicId` as returning channel data; remaining `channel info` grep hits are only meta-references to the fix itself (research dossier, this plan, state-file issue descriptions).
3. The wording in `nestjs-project/CLAUDE.md`, `state.local.json`, `openapi.json`, and `phase-03-videos.md` for this route is mutually consistent (all 7 fields, no channel).
4. Zero production code / config / migration changes in the diff (`git diff` touches only `.md` / `state.local.json` / `docs/`).
5. The workflow artifacts exist: research dossier + this plan under `docs/`.

---

# 5. RISK ANALYSIS

- **Risk:** over-correcting by implementing channel data to "match" the old doc. → **Mitigation:** Restriction above; the decided direction is to fix the doc (Option A), confirmed by the user.
- **Risk:** scope creep into the SI numbering debt or other doc tidy-ups. → **Mitigation:** explicitly deferred as registered debt; one-scope rule enforced.
- **Risk:** grep false-positives from the meta-references confusing the done check. → **Mitigation:** Stage 3 reviews each hit by intent (describes-the-route vs describes-the-fix), not by raw count.

---

# 6. ROLLBACK STRATEGY

- Single-file, single-line documentation change on an isolated branch. Rollback = revert the edit to `nestjs-project/CLAUDE.md:170` (manual re-edit, not a restricted git command). No data, build, or runtime state is affected.

---

**Next step:**
```text
/rpi:implement docs/plans/fix-channel-info-doc-plan.md
```
