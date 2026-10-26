---
kind: task
name: task-startup-infra
sources_mtime:
  docs/decisions/technical-decisions-startup-infra.md: "2026-10-26T00:29:35-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-17T23:10:16-03:00"
  docs/phases/phase-03-videos/context.md: "2026-10-17T23:10:16-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-15T21:21:34-03:00"
---

# task-startup-infra — Context

## Scope

> Docker startup/infra reliability for the Phase 03 video stack: deterministic MinIO bucket provisioning, worker entity-graph registration, and node_modules isolation so a clean `docker compose up` is operational on any host.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| startup-infra/TD-01 | ad-hoc | Repo-wide | MinIO Bucket Provisioning at Compose Startup | decided | A | — |
| startup-infra/TD-02 | ad-hoc | Backend | Worker Entity-Graph Registration | decided | A | — |
| startup-infra/TD-03 | ad-hoc | Repo-wide | `node_modules` Isolation Between Image and Bind Mount | decided | A | — |

_Source files:_

- startup-infra — `docs/decisions/technical-decisions-startup-infra.md` (scope_type: ad-hoc, related_phases: [3])

## Decisions Detail

### startup-infra/TD-01

**Recommendation:** a one-shot init container is the canonical Compose idiom for provisioning, and `service_completed_successfully` gives API and worker a clean happens-before guarantee without either racing to create the bucket. It keeps `mc` out of the runtime images, stays idempotent via `--ignore-existing`, and derives the bucket name from `$S3_BUCKET` so it cannot drift from `s3.config.ts`. Option B leaks infra provisioning into a runtime service and needs race handling; Option C overloads an unrelated service's entrypoint. (Whichever is chosen, the S3/Redis keys must be present in `.env.example` and the Joi schema so a clean clone resolves them — hosts named by Compose service, `minio`/`redis`, never `localhost`.)
**Libraries:** —

### startup-infra/TD-02

**Recommendation:** `forFeature` is precisely the discovery mechanism the project rule prescribes, and enumerating the three entities the `Video` relation graph spans is a one-line, low-risk fix that keeps the worker's discovery identical to the API's. The worker only writes `Video`; naming `Channel`/`User` for relation metadata is acceptable and their unused repositories are inert. Option B drags entire domain graphs in for metadata; Option C forks the discovery convention. If stricter ownership is later preferred, Option C is the natural fallback (explicit metadata, no foreign repositories) without the import-weight of Option B.
**Libraries:** —

### startup-infra/TD-03

**Recommendation:** baking `npm ci` into each image and carving `node_modules` out of the source bind mount with an anonymous volume is the standard pattern that makes `docker compose up -d --build` operational from a clean clone on any architecture, while keeping the bind mount (hot reload) intact. Option B still needs a populate step and drifts silently; Option C is the current failure mode. The one explicit cost — rebuild on dependency changes — is acceptable and well understood. Note this applies only after a `--build`.
**Libraries:** —

## Inherited Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** First-party `@nestjs/bullmq` integration eliminates custom boilerplate (DI, decorators, module registration follow NestJS conventions). Redis Alpine adds ~30MB to Compose — negligible cost. The project needs exactly one queue with retry/backoff for video processing; BullMQ covers this with built-in primitives. RabbitMQ's multi-language routing strengths are irrelevant for a single NestJS worker consuming one job type. pg-boss's zero-infra advantage is real but trades infrastructure simplicity for PostgreSQL load coupling and manual NestJS integration work.
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** The only option that satisfies the 10GB requirement using the native S3 protocol without adding new infrastructure. Option C is disqualified by the 5GB hard limit. Option B adds a tusd server that internally wraps the same S3 multipart operations — extra infrastructure for a resumability benefit (sub-5MB granularity) that a controlled first-party frontend does not need. The multipart flow has more API surface, but each endpoint is straightforward and `@aws-sdk/client-s3` provides all required operations (`CreateMultipartUploadCommand`, presigned `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`).
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** Meets the streaming requirement with minimal implementation: the API generates a presigned URL and redirects; MinIO handles byte serving natively. The browser's `<video>` element + MinIO's range request support provide streaming out of the box. Option B wastes API resources proxying bytes that MinIO serves directly. Option C is a significant scope expansion (transcoding pipeline, multi-rendition storage, HLS player) that the requirements do not call for.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** Resource isolation is essential (the requirement explicitly says "sem impacto na performance"), ruling out Option B. Option C's full independence creates duplication overhead with no benefit — the worker is NestJS, shares entities, and connects to the same database. A shared codebase with a dedicated entry point (`worker.main.ts` using `NestFactory.createApplicationContext()`) provides isolation without duplication.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** Produces YouTube-style short URLs that are URL-safe, compact, and have negligible collision probability at any realistic scale. UUIDv4's 36-character format creates poor sharing URLs for a video platform. Sqids' reversibility introduces enumeration risk. nanoid's ~66 bits of entropy are sufficient, and the library has zero dependencies with a large, actively maintained ecosystem.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** The worker needs exactly two FFmpeg operations: `ffprobe` for metadata and `ffmpeg` for a single thumbnail frame. A thin async wrapper around `child_process.execFile()` is ~50–80 lines, zero dependencies, and maps directly to FFmpeg documentation. fluent-ffmpeg's rich API (transcode, watermark, concat, streaming) is unused, and its uncertain maintenance status is a risk for a greenfield project. The simpler solution is easier to audit, test, and maintain for the narrow scope of operations needed.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** Matches the acceptance criteria's explicit 4-state model (rascunho → processando → pronto/erro) while providing self-contained failure diagnosis via `error_reason`. Option A's lack of error metadata forces BullMQ dashboard dependency for failure diagnosis — a coupling that leaks queue internals into operational workflows. Option C's `queued` state duplicates BullMQ's internal job tracking and adds transition complexity with negligible value in a single-worker architecture. The `error_reason` column is a single nullable field that enables future user-facing error messages without schema changes.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: ... })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; same factory importable as plain function for non-DI contexts. _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

_No inherited deferred capabilities._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Module with configured imports (`worker.module.ts` — TD-02 changes its `forFeature`) | Unit: compilation test (`Test.createTestingModule({ imports: [WorkerModule] }).compile()`) — catches the DI/entity-wiring error TD-02 fixes |

_Infra artifacts in scope — `compose.yaml`, `Dockerfile.dev`, `Dockerfile.worker`, `.env.example` (TD-01 and TD-03) — have no NestJS unit/integration/e2e layer. They are verified by the Definition of Done: a clean `docker compose up -d --build` bringing the bucket up and the worker initializing, plus `npx tsc --noEmit`, `npm run lint`, and the full suite green._
