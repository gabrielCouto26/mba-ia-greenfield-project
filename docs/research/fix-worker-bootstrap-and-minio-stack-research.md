# Research Dossier — Worker Bootstrap Crash & Clean-Stack MinIO/Env Readiness

## 1. Problem & Context

- **Objective:** Fix three defects that block the Phase 03 video pipeline from running end-to-end on a clean Docker stack:
  1. The worker crashes on startup with `Entity metadata for Video#channel was not found`, so enqueued jobs are never consumed and videos stay stuck in `processing` (no `duration`, no `thumbnail`).
  2. `WorkerModule` must register `Channel` and `User` in addition to `Video`.
  3. The MinIO bucket must be created when the stack comes up, and the S3 env vars must be present in `.env.example`, so the flow works on a fresh stack.

- **Root Cause / Trigger:**
  - **Issues 1 & 2 share one root cause.** `WorkerModule` (`src/worker.module.ts:47`) registers only `TypeOrmModule.forFeature([Video])`. The TypeORM DataSource uses `autoLoadEntities: true` (`src/worker.module.ts:43`), which loads **only** entities registered via some `forFeature`. `Video` declares `@ManyToOne(() => Channel)` (`src/videos/entities/video.entity.ts:73-75`). When TypeORM builds relation metadata at DataSource init, `Channel` is not in the entity set, so it throws `Entity metadata for Video#channel was not found`. `worker.main.ts:9-11` catches the bootstrap rejection and calls `process.exit(1)` — the worker never starts, never consumes the `video-processing` queue, so the job enqueued by complete-upload (`src/videos/services/videos.service.ts:186-189`) is never processed and the video remains in `PROCESSING` (set at `videos.service.ts:183`) with `duration`/`thumbnail_key` null. **Fixing the worker's entity registration fixes both the crash and the "stuck in processing" symptom.**
  - **Entity closure requires `User` too.** `Channel` declares `@OneToOne(() => User)` with a `@JoinColumn` (`src/channels/entities/channel.entity.ts:35-37`) and `User` declares the inverse `@OneToOne(() => Channel)` (`src/users/entities/user.entity.ts:31-32`). Registering `Channel` without `User` would fail again on `Channel#user`. The complete relation closure reachable from `Video` is **`{ Video, Channel, User }`** — all three must be registered.
  - **Issue 3a — `.env.example` is incomplete.** `.env.example` (`nestjs-project/.env.example`) has no S3/MinIO or Redis block, but the live `.env` does. In the Joi schema (`src/config/env.validation.ts:27-29`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` are `.required()`. A clean stack bootstrapped by copying `.env.example` → `.env` fails validation at startup for **both** the API and the worker (both load this schema).
  - **Issue 3b — No bucket is ever created.** `StorageService` (`src/videos/services/storage.service.ts`) assumes the bucket exists; nothing creates it. `compose.yaml` has no bucket-provisioning step. On a fresh `minio_data` volume, the first `CreateMultipartUploadCommand` (`storage.service.ts:40-50`, called by initiate-upload) targets a nonexistent bucket and fails with `NoSuchBucket`.

- **Recommended Role for rpi:plan:** Senior Backend / DevOps Engineer (NestJS + TypeORM + Docker Compose).

## 2. Codebase Mapping

- **Affected Package:** `nestjs-project`

- **Key Files & Symbols:**
  - `nestjs-project/src/worker.module.ts:13-16, 47` — **CHANGE.** Import `Channel` and `User` entities; register `TypeOrmModule.forFeature([Video, Channel, User])`.
  - `nestjs-project/src/videos/entities/video.entity.ts:73-75` — Reference: `@ManyToOne(() => Channel)` drives the metadata requirement.
  - `nestjs-project/src/channels/entities/channel.entity.ts:35-37` — Reference: `@OneToOne(() => User)` extends the closure to `User`.
  - `nestjs-project/src/users/entities/user.entity.ts:31-32` — Reference: inverse `@OneToOne(() => Channel)`; closes the graph.
  - `nestjs-project/src/worker.main.ts:4-11` — Reference: bootstrap crashes & `process.exit(1)` on the metadata error.
  - `nestjs-project/src/videos/processors/video.processor.ts` — Reference only (no change needed): consumer logic is correct; it just never runs because the worker dies.
  - `nestjs-project/src/videos/services/videos.service.ts:183-189` — Reference: sets `PROCESSING` and enqueues `video.process` with `{ videoId, storageKey }`.
  - `nestjs-project/.env.example` — **CHANGE.** Add the `# S3 / MinIO` block (and `# Redis` block).
  - `nestjs-project/compose.yaml:50-83` — **CHANGE.** Add a one-shot `minio-init` service that creates the bucket; wire `depends_on` so the API/worker wait for it.
  - `nestjs-project/src/config/env.validation.ts:27-29` — Reference: the three required S3 vars.
  - `nestjs-project/src/config/s3.config.ts` — Reference: `S3_BUCKET` → `config.bucket` used by `StorageService`.
  - `nestjs-project/src/videos/processors/video.processor.spec.ts` — Reference: existing unit test pattern (all collaborators mocked) if any worker-module coverage is added.

- **Data Model & Schema Impact:**
  - Tables touched: **None.** No entity shape change, no column change.
  - Migration required: **No.**

## 3. Clarifications & Resolved Ambiguities

- **Which entities must `WorkerModule` register?** Resolved: `Video`, `Channel`, and `User` — the full relation closure reachable from `Video`. Registering only `Video` + `Channel` would still crash on `Channel#user`.
- **Is the "stuck in processing" issue a separate bug?** Resolved: No. It is a downstream symptom of the worker never booting. No processor code change is required; verify it disappears once the worker starts.
- **Should the bucket be created in app code or infra?** Resolved: Infra (Docker Compose), per the project's Docker-first rules and to keep `StorageService` single-responsibility (it performs object operations, not provisioning). Use a one-shot `minio/mc` init container that is idempotent (`mc mb --ignore-existing`).
- **Only S3 vars in `.env.example`, or Redis too?** Resolved: S3 block is the mandatory fix (Joi `.required()`). Redis vars have Joi defaults (`REDIS_HOST=redis`, `REDIS_PORT=6379`) so they are not strictly required, but the Redis block is **also missing** from `.env.example`; add it for documentation parity with the live `.env`. Flag as a minor, in-scope completeness addition.
- **Bucket name source:** Resolved: `S3_BUCKET` (value `streamtube`). The init container must read the same value (via `env_file: .env`) so it matches what the app uses.
- **MinIO credentials for `mc`:** Resolved: the `minio` service's `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` (`streamtube` / `streamtube123`). These are the admin credentials `mc` needs to create the bucket; the app's `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` currently equal the root creds.

## 4. Technical Approach & Trade-offs

- **Recommended Approach:**
  1. **Worker entities:** In `WorkerModule`, import `Channel` and `User` and change `forFeature([Video])` → `forFeature([Video, Channel, User])`. Minimal, aligned with `.claude/rules/nestjs-modules.md` ("every entity must be registered via `forFeature`"). `autoLoadEntities` then discovers all three and relation metadata builds cleanly.
  2. **`.env.example`:** Append the `# S3 / MinIO` block (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) and the `# Redis` block (`REDIS_HOST`, `REDIS_PORT`), mirroring the live `.env` and the Docker service-name convention (`S3_ENDPOINT=http://minio:9000`, `REDIS_HOST=redis`).
  3. **Bucket creation:** Add a `minio-init` (a.k.a. `createbuckets`) service using the `minio/mc` image, `depends_on: minio (service_healthy)`, `env_file: .env`, with an entrypoint that sets an `mc` alias to `http://minio:9000` using the root creds and runs `mc mb --ignore-existing local/$S3_BUCKET` then exits 0. Add `minio-init: condition: service_completed_successfully` to `nestjs-api` (and optionally the worker) `depends_on` so uploads can't start before the bucket exists.

- **Alternatives Considered:**
  - *Create the bucket from app code (StorageService `onModuleInit` → `HeadBucket`/`CreateBucket`).* Rejected: violates single-responsibility, runs on every boot of both API and worker, and couples object operations to provisioning. Infra init is cleaner and matches the Docker-first project rules.
  - *Register only `Video` + `Channel` in the worker.* Rejected: crashes on `Channel#user`; the closure needs `User`.
  - *Pin an explicit `entities: [...]` array instead of `autoLoadEntities`.* Rejected: diverges from the existing pattern; `forFeature` + `autoLoadEntities` is the established convention and the one the rules mandate.

## 5. Blueprint for rpi:plan

### Suggested Scope Stages

1. **Stage 1 — Worker entity registration (code fix):**
   - Edit `src/worker.module.ts`: import `Channel` (`../channels/entities/channel.entity`) and `User` (`../users/entities/user.entity`); change to `TypeOrmModule.forFeature([Video, Channel, User])`.
   - Validation: `npx tsc --noEmit`, `npm run lint`, run the worker unit spec.

2. **Stage 2 — Clean-stack env (`.env.example`):**
   - Add the `# S3 / MinIO` and `# Redis` blocks to `nestjs-project/.env.example`, mirroring `.env` and using Compose service-name hosts.
   - Validation: diff `.env.example` against the Joi required set in `env.validation.ts`; confirm every `.required()` var is present.

3. **Stage 3 — Bucket provisioning (`compose.yaml`) + end-to-end verification:**
   - Add the `minio-init` service and the `service_completed_successfully` dependency on `nestjs-api`.
   - Validation: bring up a clean stack, confirm the bucket exists (`mc ls` / console), start the worker (`docker compose exec nestjs-worker npm run start:worker`) and confirm it boots without the metadata error, then run an upload→complete and confirm the video transitions `PROCESSING → READY` with `duration` and `thumbnail_key` set.

### Specific Restrictions

- **Scope discipline (CLAUDE.md):** These are related infra/boot fixes for one goal (clean-stack end-to-end). Keep them to the files listed; do **not** change entity shapes, migrations, processor logic, or add cosmetic refactors.
- **Docker networking:** Always use Compose service names as hosts (`minio`, `redis`, `db`) — never `localhost`.
- **NestJS module rule (`.claude/rules/nestjs-modules.md`):** Every entity used by the DataSource must be registered via `forFeature`; `autoLoadEntities` alone does not discover unregistered entities.
- **TypeScript (`.claude/rules/typescript-strict.md`):** Use `import` for entity classes (they are used as runtime values in the `forFeature` array, not type-only).
- **Env file conventions (`nestjs-project/CLAUDE.md`):** Quote values containing shell-special characters; keep the file shell-safe.
- **`minio-init` idempotency:** Use `mc mb --ignore-existing` and `exit 0` so re-running `docker compose up` never fails on an existing bucket.
- **Restricted commands:** No `rm -rf`, no `git reset/revert/push`, etc.

### Validation & Testing Strategy

Run inside the container (per `nestjs-project/CLAUDE.md`), prefix with `docker compose exec nestjs-api`:
- **Type-check:** `npx tsc --noEmit` (must exit 0).
- **Lint:** `npm run lint`.
- **Unit (targeted):** `npm test -- src/videos/processors/video.processor.spec.ts`.
- **Full suite before done:** `npm test -- --runInBand` and `npm run test:e2e`.
- **Manual end-to-end on a clean stack (host):**
  1. `docker compose down -v` then `docker compose up -d` (fresh `minio_data`).
  2. Confirm `minio-init` completed and bucket `streamtube` exists.
  3. `docker compose exec nestjs-worker npm run start:worker` → expect clean boot, **no** `Entity metadata for Video#channel was not found`.
  4. Exercise initiate → presign-part → complete; confirm the enqueued job is consumed and the video reaches `READY` with populated `duration` and `thumbnail_key`.
- **Specific cases to cover:** worker boots with all three entities registered (happy path); bucket-init is idempotent on a second `up`; a fresh `.env` copied from `.env.example` passes Joi validation for both API and worker.

---

*Next step: run `rpi:plan` with this dossier:*
```text
/rpi:plan docs/research/fix-worker-bootstrap-and-minio-stack-research.md
```
