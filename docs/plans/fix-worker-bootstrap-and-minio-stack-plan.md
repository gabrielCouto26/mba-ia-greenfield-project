# Execution Plan — Worker Bootstrap Crash & Clean-Stack MinIO/Env Readiness

> Source research: `docs/research/fix-worker-bootstrap-and-minio-stack-research.md`
> Package: `nestjs-project`
> Migration required: **No** (no entity shape or column change)

---

# 1. INTENTION

- **Assumed Role:** Senior Backend / DevOps Engineer (NestJS + TypeORM + Docker Compose).
- **Strategic Objective:** Make the Phase 03 video pipeline run end-to-end on a **clean Docker stack**. Today the worker crashes on boot (`Entity metadata for Video#channel was not found`), so enqueued jobs are never consumed and videos stay stuck in `PROCESSING`. On a fresh stack, uploads also fail because the MinIO bucket is never provisioned and `.env.example` is missing the S3 block required by Joi validation.
- **Architectural Mindset:** Minimal, surgical fixes that respect existing conventions. Boot correctness via the established `forFeature` + `autoLoadEntities` pattern; provisioning handled by infrastructure (Docker Compose), not application code, to preserve `StorageService` single-responsibility. No new abstractions.
- **Quality Bar:** Definition of Done (global `CLAUDE.md`): targeted tests pass → full suite passes → `npx tsc --noEmit` exits 0 → `npm run lint` passes. Plus a manual clean-stack end-to-end verification proving the worker boots and a video reaches `READY`.

---

# 2. SCOPE

## Technical Stack

- **Backend:** NestJS 11, TypeScript (strict null checks), TypeORM (`autoLoadEntities: true`, `synchronize: false`).
- **Queue:** BullMQ + Redis (`video-processing` queue).
- **Storage:** MinIO (S3-compatible) via `@aws-sdk/client-s3`.
- **Infra:** Docker Compose (`nestjs-api`, `db`, `mailpit`, `redis`, `minio`, `nestjs-worker`).

## Files to Modify

| File | Change |
|---|---|
| `nestjs-project/src/worker.module.ts` | Import `Channel` + `User`; change `forFeature([Video])` → `forFeature([Video, Channel, User])` |
| `nestjs-project/.env.example` | Append `# S3 / MinIO` block and `# Redis` block, mirroring the live `.env` with Compose service-name hosts |
| `nestjs-project/compose.yaml` | Add one-shot `minio-init` service (idempotent bucket creation); wire `depends_on: service_completed_successfully` on `nestjs-api` and `nestjs-worker` |

## Files Referenced (no change)

- `src/videos/entities/video.entity.ts:73-75` — `@ManyToOne(() => Channel)` drives the metadata requirement.
- `src/channels/entities/channel.entity.ts:35-37` — `@OneToOne(() => User)` extends the closure to `User`.
- `src/users/entities/user.entity.ts:31-32` — inverse `@OneToOne(() => Channel)`; closes the graph.
- `src/worker.main.ts:4-11` — bootstrap catches the error and `process.exit(1)`.
- `src/videos/processors/video.processor.ts` — consumer logic is correct; it just never runs. **No change.**
- `src/config/env.validation.ts:27-29` — the three `.required()` S3 vars.
- `src/config/s3.config.ts` — `S3_BUCKET` → `config.bucket`.

---

## Execution Stages (ordered, incremental)

### Stage 1 — Worker Entity Registration (code fix)

**What:** The full relation closure reachable from `Video` is `{ Video, Channel, User }`. With `autoLoadEntities: true`, TypeORM only discovers entities registered via some `forFeature`. Register all three in `WorkerModule`.

Edit `src/worker.module.ts`:
- Add runtime `import` (not `import type` — the classes are used as runtime values in the `forFeature` array):
  - `import { Channel } from './channels/entities/channel.entity';`
  - `import { User } from './users/entities/user.entity';`
- Change line 47: `TypeOrmModule.forFeature([Video])` → `TypeOrmModule.forFeature([Video, Channel, User])`.

**Why `User` is mandatory:** registering only `Video` + `Channel` still crashes on `Channel#user` (`@OneToOne(() => User)` with `@JoinColumn`).

**Validation (inside container):**
- `docker compose exec nestjs-api npx tsc --noEmit` → exit 0
- `docker compose exec nestjs-api npm run lint`
- `docker compose exec nestjs-api npm test -- src/videos/processors/video.processor.spec.ts`

**Gate:** do not proceed to Stage 2 until type-check and lint pass.

---

### Stage 2 — Clean-Stack Env (`.env.example`)

**What:** Append the missing blocks to `nestjs-project/.env.example` so a fresh `.env` copied from it passes Joi validation for **both** API and worker. Mirror the live `.env`, using Compose service-name hosts.

Add:

```dotenv
# S3 / MinIO
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=streamtube
S3_ACCESS_KEY_ID=streamtube
S3_SECRET_ACCESS_KEY=streamtube123

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
```

> Confirm the exact var names and values against the live `.env` and `src/config/s3.config.ts` / `redis.config.ts` before writing. `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` are Joi `.required()`; `REDIS_HOST`/`REDIS_PORT` have defaults but are added for documentation parity.

**Validation:** cross-check every `.required()` var in `src/config/env.validation.ts` against `.env.example` — all three S3 vars present. Keep values shell-safe (no unquoted special chars).

---

### Stage 3 — Bucket Provisioning (`compose.yaml`) + End-to-End Verification

**What:** Add an idempotent one-shot init container that creates the `S3_BUCKET` bucket before the app can issue its first `CreateMultipartUploadCommand`.

Add a `minio-init` service to `compose.yaml`:
- Image: `minio/mc` (pin a specific tag; verify a current stable tag via context7/registry before writing).
- `depends_on: minio: { condition: service_healthy }`
- `env_file: .env` (so it reads the same `S3_BUCKET` the app uses).
- Entrypoint that: sets an `mc` alias to `http://minio:9000` using the **root** creds (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` = `streamtube` / `streamtube123`), runs `mc mb --ignore-existing local/$S3_BUCKET`, then exits 0.

Wire dependencies so uploads cannot start before the bucket exists:
- `nestjs-api.depends_on.minio-init: { condition: service_completed_successfully }`
- `nestjs-worker.depends_on.minio-init: { condition: service_completed_successfully }`

**Validation — targeted:** `docker compose config` parses without error.

**Validation — manual clean-stack end-to-end (host):**
1. `docker compose down -v` then `docker compose up -d` (fresh `minio_data` volume).
2. Confirm `minio-init` completed successfully and bucket `streamtube` exists (`docker compose exec minio mc ls local/`).
3. `docker compose exec nestjs-worker npm run start:worker` → expect clean boot, **no** `Entity metadata for Video#channel was not found`.
4. Exercise `initiate → presign-part → complete`; confirm the enqueued job is consumed and the video transitions `PROCESSING → READY` with populated `duration` and `thumbnail_key`.
5. Re-run `docker compose up -d` and confirm `minio-init` is idempotent (no failure on the existing bucket).

---

## Testing Strategy (Definition of Done)

All commands run inside the container (`docker compose exec nestjs-api`), per `nestjs-project/CLAUDE.md`:

- **Type-check:** `npx tsc --noEmit` → exit 0.
- **Lint:** `npm run lint`.
- **Unit (targeted):** `npm test -- src/videos/processors/video.processor.spec.ts`.
- **Full suite before done:** `npm test -- --runInBand` and `npm run test:e2e` (already `--runInBand`).
- **Manual E2E:** the clean-stack flow in Stage 3.

**Specific cases to cover:**
- Worker boots with all three entities registered (happy path).
- A fresh `.env` copied from `.env.example` passes Joi validation for both API and worker.
- `minio-init` is idempotent on a second `up`.

## Expected Outputs

- `WorkerModule` registering `[Video, Channel, User]`; worker boots cleanly.
- `.env.example` complete — a fresh copy passes startup validation.
- A `minio-init` service that provisions the bucket on a clean stack.
- A video upload completing the full pipeline to `READY` with `duration` + `thumbnail_key`.

---

# 3. RESTRICTIONS

- **Scope discipline (CLAUDE.md):** change only the three listed files. Do **not** alter entity shapes, add migrations, touch processor/service logic, or introduce cosmetic refactors (formatting/renaming) alongside these functional fixes.
- **Docker networking:** always use Compose service names as hosts (`minio`, `redis`, `db`) — never `localhost`/`127.0.0.1`.
- **NestJS module rule (`.claude/rules/nestjs-modules.md`):** every entity used by the DataSource must be registered via `forFeature`; `autoLoadEntities` alone does not discover unregistered entities.
- **TypeScript (`.claude/rules/typescript-strict.md`):** use runtime `import` (not `import type`) for `Channel`/`User` — they are runtime values in the `forFeature` array.
- **Env file conventions (`nestjs-project/CLAUDE.md`):** quote any value with shell-special characters; keep `.env.example` shell-safe.
- **`minio-init` idempotency:** use `mc mb --ignore-existing` and ensure the container exits 0 so repeated `docker compose up` never fails.
- **Anti-patterns to avoid:**
  - Creating the bucket from app code (`StorageService.onModuleInit`) — rejected: violates single-responsibility, runs on every boot of both API and worker.
  - Registering only `Video` + `Channel` — rejected: crashes on `Channel#user`.
  - Replacing `autoLoadEntities` with an explicit `entities: [...]` array — rejected: diverges from the established convention.
- **Restricted commands:** no `rm -rf`, no `git reset` / `git revert` / `git push`, no history rewrites. `docker compose down -v` is permitted (it only drops this project's named volumes for the clean-stack test).
- **Library lookups:** verify the `minio/mc` image tag and any `mc`/Compose `depends_on` condition syntax against current docs (context7 / official registry) before finalizing `compose.yaml`.

---

# 4. SUCCESS CRITERIA

Objective, verifiable indicators:

1. `nestjs-worker` boots with **no** `Entity metadata for Video#channel was not found` error and stays running to consume the `video-processing` queue.
2. On a clean stack (`down -v` → `up -d`), the `streamtube` bucket exists and `minio-init` exits with `service_completed_successfully`.
3. A fresh `.env` copied from `.env.example` passes Joi validation at startup for both API and worker (no missing-required-var error).
4. A full upload flow (`initiate → presign-part → complete`) drives a video from `PROCESSING` to `READY` with non-null `duration` and `thumbnail_key`.
5. `npx tsc --noEmit` exits 0.
6. `npm run lint` passes.
7. Full unit/integration suite (`npm test -- --runInBand`) and `npm run test:e2e` pass.
8. No changes outside the three in-scope files; no new migration.

---

# 5. RISK ANALYSIS

| Risk | Likelihood | Mitigation |
|---|---|---|
| `minio/mc` entrypoint/alias syntax differs from assumption | Medium | Verify `mc alias set` + `mc mb` syntax and a stable image tag via context7/registry before writing; test with `docker compose config` and the clean-stack bring-up. |
| `depends_on: service_completed_successfully` not honored (older Compose) | Low | Confirm Compose version supports it; it is standard in Compose Spec v2+. |
| Integration/e2e specs need live MinIO/Redis containers | Medium | Run the full suite with the stack up (`docker compose exec nestjs-api`), per the testing policy. |
| `.env.example` value drift vs live `.env` | Low | Cross-check names/values against `.env`, `s3.config.ts`, `redis.config.ts`, and the Joi schema before writing. |

---

*Next step — run the implementation:*
```text
/rpi:implement docs/plans/fix-worker-bootstrap-and-minio-stack-plan.md
```
