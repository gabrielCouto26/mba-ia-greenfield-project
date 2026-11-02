# Research Dossier — Align stale documentation with the real implementation (videos + auth)

> Date: 2026-11-02 · Branch: `fix/channel-info` · Type: documentation-only correction (follow-up audit)

## 1. Problem & Context

- **Objective:** A project-wide audit (requested after the `channel-info` fix) found four prose-documentation statements that describe behavior the code does not have — the same class of defect as the original external feedback. Align the docs to the implementation. No production code changes.
- **Root Cause / Trigger:** Summary/prose docs (root `README.md`, `state.local.json`) drifted from the code. The earlier `channel-info` fix searched only the exact English phrase "channel info" and missed the Portuguese equivalent ("canal") in `README.md`, plus three unrelated doc/code divergences surfaced by the broader audit.
- **Recommended Role for rpi:plan:** Backend Documentation Maintainer / Technical Writer.
- **Source of truth used:** `nestjs-project/openapi.json` (generated from controllers) + the actual controller/service/entity code.

## 2. Codebase Mapping

### Findings (doc → real behavior)

**F1 — `README.md:140` says the public video-info route returns "canal" (channel).**
- Doc: `` | `GET /videos/:publicId` | Público | Metadados, status, canal e thumbnail URL | ``
- Real: `VideosService.findByPublicId` (`videos.service.ts:128-155`) returns only `id, public_id, title, status, duration, thumbnail_url, created_at` — no channel. Same bug as the external feedback, in Portuguese. Unfixed by the `channel-info` branch (English-only grep).

**F2 — Video status cycle names non-existent states `UPLOADING` and `FAILED`.**
- Real enum (`video.entity.ts:13-18`): `draft, processing, ready, error`.
- Real transitions: `create → DRAFT` (`videos.service.ts:48`); `completeUpload → PROCESSING` (`:183`/`:194`); worker `→ READY` (`video.processor.ts:58`) or `ERROR` (`:66`). Correct cycle: **`DRAFT → PROCESSING → READY` (or `ERROR`)**.
- Docs wrong: `README.md:144` (`DRAFT → UPLOADING → PROCESSING → READY` (ou `FAILED`)); `state.local.json:118` (same) and `:105` ("marks the video READY/FAILED").

**F3 — `state.local.json:176` says `abort` "mark FAILED".**
- Real: `abortUpload` (`videos.service.ts:86-104`) aborts the S3 multipart upload and sets `upload_id: null` — it does **not** change `status` (and `FAILED` is not a valid state). Controller returns 204.

**F4 — `state.local.json` says login stores JWT in a cookie (backend).**
- Doc: `:167` ("POST /auth/login — login, returns JWT access token in cookie") and `:89` (Phase 02 Auth Backend: "JWT stored in HttpOnly cookies").
- Real: `AuthController.login` (`auth.controller.ts:146-149`) returns `{ access_token, refresh_token }` in the **response body** (openapi 200 body). The NestJS backend sets **no cookies** (`grep cookie|@Res` over `nestjs-project/src` non-test = empty). The HttpOnly cookie is the **Next.js BFF** (iron-session), not the API. `README.md:159` ("retorna access + refresh token") is already correct.

### Data Model & Schema Impact
- Tables touched: None. Migration required: No. Production code changed: No.

## 3. Clarifications & Resolved Ambiguities

- **Scope grouping:** All four are doc-only corrections of the same class (prose vs. code). The user explicitly asked to fix "os pontos que você levantou" together and to advance autonomously, so they are handled as one documentation-accuracy task rather than four micro-workflows. F1 is the same scope as the current `fix/channel-info` branch; F2–F4 extend the same "docs must match code" theme.
- **Correct vs. implement:** As with `channel-info`, the direction is to fix the docs (code is the truth). None of these implies a code change.
- **Branch:** Work continues on the unmerged `fix/channel-info` branch as a second commit (doc-only, thematically consistent). No new feature branch ceremony, per the autonomous instruction.
- **No open business ambiguities.**

## 4. Technical Approach & Trade-offs

- **Recommended Approach:** Edit the exact prose lines to match the code. Suggested wording:
  - F1 `README.md:140` → `` | `GET /videos/:publicId` | Público | Info pública do vídeo: id, public_id, title, status, duration, thumbnail_url, created_at | ``
  - F2 `README.md:144` → "O status do vídeo segue o ciclo: `DRAFT → PROCESSING → READY` (ou `ERROR`)."; `state.local.json` status-model text → `DRAFT -> PROCESSING -> READY (or ERROR, with error_reason)` and "marks the video READY/ERROR".
  - F3 `state.local.json:176` → "abort multipart upload; clears upload_id without changing status".
  - F4 `state.local.json:167` → "login, returns access_token + refresh_token in the response body"; `:89` → clarify the HttpOnly cookie is the Next.js BFF (iron-session), the NestJS API returns tokens in the body.
- **Alternatives Considered:** Splitting into 4 separate branches/commits — rejected as disproportionate for doc-only, same-class fixes the user grouped together.

## 5. Blueprint for rpi:plan

### Suggested Scope Stages
1. **Stage 1 — README (user-facing):** fix F1 (`README.md:140`) and F2 (`README.md:144`).
2. **Stage 2 — state.local.json (agent context):** fix F2 (`:105`,`:118`), F3 (`:176`), F4 (`:89`,`:167`).
3. **Stage 3 — Consistency check:** grep the repo to confirm no doc describes the video-info route as returning channel/canal, no doc names `UPLOADING`/`FAILED` as video states, and login is described as body-token everywhere.

### Specific Restrictions
- Documentation only — no `.ts`/config/migration changes.
- Do not touch `openapi.json`, controllers, services, entities, or `phase-03-videos.md` (already correct).
- Do not fix the registered SI-03.7/03.9 numbering debt here (separate scope).
- Git: stay on `fix/channel-info`; no restricted git commands.

### Validation & Testing Strategy
- No automated tests (no code). Factual verification via grep:
  - `grep -rn "canal\|channel" README.md` around the video-info row → no channel in the return.
  - `grep -rn "UPLOADING\|FAILED" README.md state.local.json | grep -v node_modules` → no video-state usage.
  - `grep -rn "in cookie\|stored in HttpOnly" state.local.json` → none describing the backend login.
- Optional sanity: `git diff` touches only `README.md` / `state.local.json` / `docs/`.
