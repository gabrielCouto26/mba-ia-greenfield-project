---
kind: task
name: task-presigned-url-public-endpoint
sources_mtime:
  docs/decisions/technical-decisions-presigned-url-public-endpoint.md: "2026-10-26T20:01:55-03:00"
  docs/decisions/technical-decisions-startup-infra.md: "2026-10-26T16:36:18-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-10-15T21:21:34-03:00"
  docs/phases/phase-03-videos/context.md: "2026-10-17T23:10:16-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-15T21:21:34-03:00"
---

# task-presigned-url-public-endpoint — Context

## Scope

> Public-reachable endpoint for presigned S3/MinIO URLs so external clients (browser, frontend, host curl) can consume upload PUT, stream/download GET, and thumbnail URLs that are currently signed with the Docker-internal host minio:9000. Backend-only change in `nestjs-project`: split S3 client (internal host for server-side ops, public endpoint for presigning), second `S3Client` for the presigner, new optional `S3_PUBLIC_ENDPOINT` env var validated via Joi with fallback to `S3_ENDPOINT`.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| presigned-url-public-endpoint/TD-01 | ad-hoc | Backend | Presign Endpoint Strategy (internal vs public host) | decided | A (split endpoint — internal client + public presigner) | — |
| presigned-url-public-endpoint/TD-02 | ad-hoc | Backend | Presigner Client Realization (dedicated vs per-call override) | decided | A (dedicated second S3Client) | — |
| presigned-url-public-endpoint/TD-03 | ad-hoc | Backend | `S3_PUBLIC_ENDPOINT` Default and Validation | decided | A (optional, fallback to S3_ENDPOINT) | — |

_Source files:_

- presigned-url-public-endpoint — `docs/decisions/technical-decisions-presigned-url-public-endpoint.md` (scope_type: ad-hoc, related_phases: [3])

## Decisions Detail

### presigned-url-public-endpoint/TD-01

**Recommendation:** it is the only option that keeps server-side traffic on the Docker-internal host (respecting the Docker rule) while making presigned URLs reachable by external clients, and it is the one that degrades correctly into production (public domain for presigns, internal host gone). Option B exports an infra workaround to every machine and diverges from prod; Option C breaks all server-side S3 calls. The split applies to **all** presign sites — upload PUT included — because the multipart upload (phase-03 TD-02) is a client-direct PUT, so its client is external too.
**Libraries:** —

### presigned-url-public-endpoint/TD-02

**Recommendation:** explicit, immutable endpoint binding eliminates the class of bug where a server-side operation signs with the public host or a presign uses the internal one, and it is directly unit-testable. The per-call override has no clean v3 API and trades a negligible memory saving for real correctness and testability risk.
**Libraries:** —

### presigned-url-public-endpoint/TD-03

**Recommendation:** it ships the fix with zero regression risk (unset → current behavior), keeps dev onboarding a one-line `.env.example` entry, and lets prod point at the real S3/CDN domain. The `.uri()` constraint catches malformed values without making the var mandatory. Required (C) needlessly breaks existing environments; a hard `localhost` default (B) is wrong everywhere but a local host.
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

### startup-infra/TD-01

**Recommendation:** a one-shot init container is the canonical Compose idiom for provisioning, and `service_completed_successfully` gives API and worker a clean happens-before guarantee without either racing to create the bucket. It keeps `mc` out of the runtime images, stays idempotent via `--ignore-existing`, and derives the bucket name from `$S3_BUCKET` so it cannot drift from `s3.config.ts`. Option B leaks infra provisioning into a runtime service and needs race handling; Option C overloads an unrelated service's entrypoint. (Whichever is chosen, the S3/Redis keys must be present in `.env.example` and the Joi schema so a clean clone resolves them — hosts named by Compose service, `minio`/`redis`, never `localhost`.)
**Libraries:** —

### startup-infra/TD-02

**Recommendation:** `forFeature` is precisely the discovery mechanism the project rule prescribes, and enumerating the three entities the `Video` relation graph spans is a one-line, low-risk fix that keeps the worker's discovery identical to the API's. The worker only writes `Video`; naming `Channel`/`User` for relation metadata is acceptable and their unused repositories are inert. Option B drags entire domain graphs in for metadata; Option C forks the discovery convention. If stricter ownership is later preferred, Option C is the natural fallback (explicit metadata, no foreign repositories) without the import-weight of Option B.
**Libraries:** —

### startup-infra/TD-03

**Recommendation:** baking `npm ci` into each image and carving `node_modules` out of the source bind mount with an anonymous volume is the standard pattern that makes `docker compose up -d --build` operational from a clean clone on any architecture, while keeping the bind mount (hot reload) intact. Option B still needs a populate step and drifts silently; Option C is the current failure mode. The one explicit cost — rebuild on dependency changes — is acceptable and well understood. Note this applies only after a `--build`.
**Libraries:** —

### phase-01-configuracao-base/TD-01

**Recommendation:** Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** —

### phase-01-configuracao-base/TD-02

**Recommendation:** First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** —

### phase-01-configuracao-base/TD-03

**Recommendation:** The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
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
| Service with side-effect dep (storage/MinIO) — `StorageService` presign methods | Integration: real MinIO/S3 contract (assert presign methods sign with the public endpoint and `send()`-based ops use the internal endpoint) + Unit for branching |
| Service with configured lib (`S3Client`) | Unit: real client with test config (assert resolved endpoint per client) |
| Config factory (`s3.config.ts`) + Joi env schema (`env.validation.ts`) | No dedicated layer — exercised via the StorageService integration/unit tests and env-validation startup; add a focused unit assertion on the `publicEndpoint` fallback chain if branching warrants |

_Note: no new Entity, Module, Controller, DTO, Guard, or Filter is introduced by this scope, so their test layers do not apply. Test suffixes: `*.spec.ts` (unit), `*.integration-spec.ts` (real DB/MinIO), `*.e2e-spec.ts` (HTTP) — run integration/e2e with `--runInBand`._
