# Execution Plan — Align stale documentation with the real implementation

> Source research: `docs/research/docs-match-implementation-research.md`
> Branch: `fix/channel-info` · Date: 2026-11-02 · Type: documentation-only correction

---

# 1. INTENTION

- **Assumed role:** Backend Documentation Maintainer / Technical Writer.
- **Strategic objective:** Fix four prose-doc statements that describe behavior the code does not have (same class as the external feedback), making the docs match the implementation. Source of truth: `openapi.json` + the controller/service/entity code.
- **Architectural mindset:** Generated contract (`openapi.json`) and code are authoritative; summary prose (`README.md`, `state.local.json`) must follow them.
- **Quality bar:** After the change, no doc describes `GET /videos/:publicId` as returning channel/canal; no doc names `UPLOADING`/`FAILED` as video states; login is described as returning tokens in the response body everywhere. Zero production code touched.

---

# 2. SCOPE

## Technical stack involved
- Markdown (`README.md`) and JSON (`state.local.json`). No TypeScript, build, runtime, DB, or migration.

## Files to modify
| File | Lines | Finding | Action |
|---|---|---|---|
| `README.md` | 140 | F1 | Replace "Metadados, status, canal e thumbnail URL" with the real 7-field return. |
| `README.md` | 144 | F2 | Fix status cycle to `DRAFT → PROCESSING → READY` (ou `ERROR`). |
| `state.local.json` | 105, 118 | F2 | Replace `UPLOADING`/`FAILED` with the real `draft→processing→ready/error` model. |
| `state.local.json` | 176 | F3 | abort = clears upload_id, does not change status. |
| `state.local.json` | 89, 167 | F4 | login returns tokens in body; HttpOnly cookie is the Next.js BFF, not the API. |

## Files explicitly NOT changed (already correct — do not touch)
- `nestjs-project/openapi.json`, `nestjs-project/src/**` (controllers/services/entities), `docs/phases/phase-03-videos/phase-03-videos.md`, `README.md:159` (login already correct), `nestjs-project/CLAUDE.md:170` (already fixed).

## Execution stages

### Stage 1 — README (user-facing)
- **What:** Fix F1 (`README.md:140`) and F2 (`README.md:144`) per the research wording.
- **How validated:** Re-read both lines; `grep -n "canal\|UPLOADING\|FAILED" README.md` shows neither in the video-info row nor the status cycle.
- **Gate:** Both README lines confirmed before Stage 2.

### Stage 2 — state.local.json (agent context)
- **What:** Fix F2 (`:105`,`:118`), F3 (`:176`), F4 (`:89`,`:167`).
- **How validated:** JSON parses (`python3 -c "import json; json.load(...)"`); re-read each edited line.
- **Gate:** JSON valid + lines confirmed before Stage 3.

### Stage 3 — Repository-wide consistency check
- **What:** Confirm no remaining doc divergence for these four topics.
- **How validated:**
  - `grep -rn "canal\|channel" README.md` → video-info row lists fields, no channel.
  - `grep -rn "UPLOADING\|FAILED" README.md state.local.json | grep -v node_modules` → no video-state usage (summary "READY/FAILED" gone).
  - `grep -rn "in cookie\|stored in HttpOnly" state.local.json` → none describing backend login.
  - `git diff --stat` → only `README.md`, `state.local.json`, `docs/`.

## Testing strategy
- No automated suite (doc-only). Factual grep verification is the acceptance criterion.

## Expected outputs
- Corrected `README.md` (2 lines) and `state.local.json` (5 spots).
- Clean grep review; diff limited to docs.
- Workflow artifacts under `docs/`.

---

# 3. RESTRICTIONS

- **Documentation only.** No `.ts`/config/migration edits. If any seems needed, stop — scope is wrong.
- **One class of change.** Only the four audited divergences; no drive-by rewrites, reformatting, or reordering.
- **Do not touch** `openapi.json`, backend source, or `phase-03-videos.md` — already correct.
- **Do not** fix the SI-03.7/03.9 numbering debt here (separate registered scope).
- **Git:** stay on `fix/channel-info`; never commit to `main`; no restricted commands (`push`, `reset`, `rebase`, …).

---

# 4. SUCCESS CRITERIA

1. `README.md:140` lists the real 7 fields, no "canal".
2. `README.md:144` and `state.local.json` describe the status cycle as `draft → processing → ready/error`; no `UPLOADING`/`FAILED` anywhere as a video state.
3. `state.local.json` describes `abort` as clearing upload_id without a status change.
4. `state.local.json` describes login as returning `access_token`+`refresh_token` in the body; the HttpOnly cookie is attributed to the Next.js BFF.
5. `state.local.json` parses as valid JSON.
6. `git diff` touches only `README.md`, `state.local.json`, and `docs/` — zero `.ts`/config/migration.

---

# 5. ROLLBACK STRATEGY

- Doc-only edits on an isolated, unmerged branch. Rollback = re-edit the affected lines. No data/build/runtime impact.

---

**Next step:**
```text
/rpi:implement docs/plans/docs-match-implementation-plan.md
```
