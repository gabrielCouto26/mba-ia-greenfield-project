---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-15 21:21:34.580019736 -0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-16 18:16:26.754943772 -0300"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-15 21:21:34.577088725 -0300"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-15 21:21:34.578826058 -0300"
  docs/phases/phase-02-auth/context.md: "2026-10-15 21:21:34.579310485 -0300"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-15 21:21:34.578937177 -0300"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-15 21:21:34.493847766 -0300"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:**

- `nestjs-project` — implied by backend API processing (upload, video processing, streaming endpoints)

**Deferred subprojects:** _None._

**Sequencing notes:** Depende de: Fase 01, Fase 02. Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única.

**Neighbors (for boundary detection only):**

- **Phase 02:** Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha.
- **Phase 04:** Edição das informações do vídeo, fluxo de rascunho e publicação, painel de administração do canal e página pública.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Queue Technology | decided | A (BullMQ + Redis) | — |
| phase-03-videos/TD-02 | phase | Cross-layer | Upload Strategy for Large Files (10GB) | decided | A (S3 Multipart via Presigned URLs) | — |
| phase-03-videos/TD-03 | phase | Cross-layer | Video Streaming and Download Strategy | decided | A (Presigned GET URL Redirect) | — |
| phase-03-videos/TD-04 | phase | Backend | Worker Architecture | decided | A (Separate Container, Same Codebase) | — |
| phase-03-videos/TD-05 | phase | Backend | Unique Video URL Generation | decided | A (nanoid, 11 characters) | — |
| phase-03-videos/TD-06 | phase | Backend | Video Processing Tooling (FFmpeg Wrapper) | decided | B (Direct child_process) | — |
| phase-03-videos/TD-07 | phase | Backend | Video Status Lifecycle and Failure Handling | decided | B (4-State with Error Metadata) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-06, phase-03-videos/TD-07 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04, phase-03-videos/TD-06, phase-03-videos/TD-07 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-03 |
| Download do vídeo pelo usuário | phase-03-videos/TD-03 |

## Decisions Detail

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

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. Single-instance with no distributed requirements, so in-memory storage is sufficient.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) Architectural fit — the strict-BFF model nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match. (2) Smaller blast radius — a ~50-LOC session helper is grep-friendly and debuggable. (3) Compatibility with Next.js 16 / React 19.
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) Defense in depth on the cookie content — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection. (2) Single cookie to manage simplifies logout. (3) Room to carry minimal user metadata lets RSC render authenticated chrome without per-render round-trip.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) Decoupled from TD-05 — works with Route Handlers OR Server Actions. (2) Aligned with shadcn's canonical form primitive. (3) Zod-first developer ergonomics match the rest of the FE foundation.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) Strict-BFF alignment — Route Handlers as the BFF surface. (2) Test scaffold already exists for Route-Handlers-as-functions. (3) Single mutation surface — Phase 02 sets the precedent for Phases 03–07.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) No first-render flicker, no round-trip — session delivered in the same response as the page HTML. (2) No new BFF endpoint — the cookie is the source of truth, RSC reads it, the Provider broadcasts it.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) First-paint-correct. (2) Single integration pattern across both flows — confirmation is RSC-only; reset is RSC + Client form. (3) Email-prefetch behavior is solved at the backend's idempotent-confirmation level.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Option A (Zod 4) — Type-inference matches the FE's strict-TS culture; ecosystem gravity in Next.js / React 19; direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`).
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** Option A (`@t3-oss/env-nextjs`) — type-level NEXT_PUBLIC_ prefix enforcement, runtime Proxy-based leak detection, single-file ergonomics.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Option A (Strict BFF — single server-only `API_URL`) — eliminates CORS, eliminates public exposure of the backend URL.
**Libraries:** —

### next-frontend-msw-foundation/TD-01

**Recommendation:** Option B (per-domain modules + barrel) — MSW's own best-practice recommends it; domain ownership tracks the codebase; append-only growth with minimal merge conflicts.
**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** Option A (test-only, `setupServer` only at the foundation) — the browser worker is a future capability with no documented current consumer.
**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** Option D (hand-written defaults as the default + opt-in seeded faker for bulk collections).
**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** Option A (universal handler set + `server.use(...)` overrides + `onUnhandledRequest: "error"`) — loading all handlers is the canonical MSW v2 model.
**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** Option A (`openapi-typescript` + `openapi-fetch`) — types-first matches the FE foundation; MSW typing is solved by the same `paths` symbol.
**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** Option B (committed local copy + repo-root sync script) — preserves compose-stack independence; drift eliminated structurally when paired with TD-03's CI freshness check.
**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** Option C (committed + CI freshness check) — makes contract drift both visible (in PR diffs) and impossible to merge accidentally (CI fail).
**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** Option A (single `lib/api/contracts.ts` with explicit aliases) — handles pass-through and reshape with the same mechanism; gives a single grep target.
**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** Option A (hand-written, typed via `paths`) — determinism over auto-generation; coherence with TD-01 recommendation.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** Option A (`@nestjs/swagger`) — preserves decisions anteriores (`class-validator` em TD-06 de phase-02-auth); CLI plugin com `classValidatorShim: true` aproveita os decoradores existentes.
**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** Option C (Ambos) — UI interativa para dev/QA + JSON export para codegen offline. Custo marginal sobre Option A é apenas um npm script.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Option B (Apenas em dev/staging) — alinha com a postura defensiva de phase 02; `openapi.json` commitado em TD-02 cumpre o papel de spec consultável.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: ... })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; same factory importable as plain function for non-DI contexts. _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships sending the e-mail; reset-password destination screen absent from Figma. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both deferred. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

### next-frontend

_Deferred subproject — testing requirements will be defined when the testing-guide skill is created._
