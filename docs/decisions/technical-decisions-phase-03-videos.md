---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-16
scope_description: "Backend infrastructure for video upload, processing, and streaming: queue technology, large-file upload strategy, video streaming/download, worker architecture, unique URL generation, FFmpeg tooling, and video status lifecycle."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend API and worker that deliver video upload endpoints, multipart upload orchestration, video processing queue, FFmpeg-based metadata extraction and thumbnail generation, streaming/download via presigned URLs, and the new Docker Compose services (Redis, MinIO, worker container).
- `next-frontend/` — no implementation in Phase 03; TD-02 and TD-03 define cross-layer API contracts that the frontend will consume in Phases 04–05. No open decision in this document.

---

## TD-01: Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The project-plan.md explicitly marks the queue technology as TBD — this is the main stack decision of Phase 03. The queue must support: job enqueue after upload completion, retry with exponential backoff on processing failure, dead-letter handling for unrecoverable errors, and job status tracking. The project already runs PostgreSQL; adding Redis is a new infrastructure dependency.

**Options:**

### Option A: BullMQ + Redis
- Redis-backed queue library for Node.js with first-party NestJS integration via `@nestjs/bullmq`. Supports priorities, delayed jobs, rate limiting, repeatable jobs, job flows, and retry with exponential backoff. Dead-letter via `maxStalledCount` + failed job retention. Redis 7 Alpine image ~30MB.
- **Pros:** Official `@nestjs/bullmq` module — `BullModule.forRoot()`, `@Processor()` decorator, full DI injection. Rich feature set (flows, rate limiting, groups, job progress). Battle-tested (~500K weekly downloads). Redis Alpine is lightweight (~30MB). Dashboard available via `@bull-board`. Active maintenance aligned with NestJS release cycle.
- **Cons:** Adds Redis as a new infrastructure dependency. Redis is in-memory — data loss on restart without persistence config (RDB/AOF). Job data stored separately from business data (no transactional enqueue with PostgreSQL writes — must handle consistency via application-level compensation).

### Option B: RabbitMQ (AMQP)
- General-purpose message broker supporting AMQP 0-9-1. NestJS integration via `@nestjs/microservices` with `Transport.RMQ`. Supports exchanges, routing keys, dead-letter exchanges, and acknowledgment-based delivery.
- **Pros:** Language-agnostic protocol — producers and consumers can be in different stacks. Supports complex routing topologies (fanout, topic, headers). Mature management UI on port 15672. Strong delivery guarantees with publisher confirms and consumer acks. Persistent queues survive broker restarts.
- **Cons:** Significantly heavier image (~150MB+). AMQP protocol adds conceptual overhead (exchanges, bindings, virtual hosts) for a single-consumer, single-queue use case. No first-party `@nestjs/bullmq`-equivalent module — uses generic microservices transport with less ergonomic API. Overkill for a project with one producer (API) and one consumer (worker) processing one job type.

### Option C: pg-boss (PostgreSQL)
- Job queue built directly on PostgreSQL using `SKIP LOCKED` for exactly-once delivery. No additional infrastructure — uses the project's existing PostgreSQL instance. Supports priorities, exponential backoff, cron scheduling, and dead-letter queues.
- **Pros:** Zero new infrastructure — reuses existing PostgreSQL. Transactional enqueue — can insert job and update video status in a single DB transaction (ACID). Simpler operational model (one data store). No Redis to monitor, back up, or configure.
- **Cons:** No official NestJS module — requires custom provider/module wrapper around `boss.start()`, `send()`, `work()`. Polling-based — adds load to PostgreSQL under high job volume. Queue operations share connection pool with business queries. Lower throughput than Redis-backed solutions under heavy load. Smaller community and ecosystem.

**Recommendation:** **Option A (BullMQ + Redis)** — First-party `@nestjs/bullmq` integration eliminates custom boilerplate (DI, decorators, module registration follow NestJS conventions). Redis Alpine adds ~30MB to Compose — negligible cost. The project needs exactly one queue with retry/backoff for video processing; BullMQ covers this with built-in primitives. RabbitMQ's multi-language routing strengths are irrelevant for a single NestJS worker consuming one job type. pg-boss's zero-infra advantage is real but trades infrastructure simplicity for PostgreSQL load coupling and manual NestJS integration work.

**Decision:** A (BullMQ + Redis)

---

## TD-02: Upload Strategy for Large Files (10GB)

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** The project requires uploading video files up to 10GB without blocking the API server. The S3 protocol imposes a hard 5GB limit on single PUT operations — files above 5GB must use multipart upload. The file must never flow through the NestJS API (requirement: "sem segurar a API durante o envio"). MinIO (S3-compatible) is the storage backend; `@aws-sdk/client-s3` is the SDK (S3-compatible, works identically on MinIO and S3). The upload flow creates a video record as draft before the file transfer begins (capability: "pré-cadastro automático do vídeo como rascunho").

**Options:**

### Option A: S3 Multipart Upload via Presigned URLs
- The API orchestrates the multipart lifecycle while the client uploads each part directly to MinIO. Flow: API creates draft record → initiates multipart upload → generates presigned URLs per part → client PUTs parts directly to MinIO in parallel → API completes the multipart upload and enqueues processing. Parts range 5MB–5GB; up to 10,000 parts per upload.
- **Pros:** Native S3/MinIO protocol — zero middleware or proxy server. Parts upload in parallel, improving throughput on fast connections. Each part is independently retryable (failed part does not restart the upload). Supports files up to 5TB (far exceeds the 10GB requirement). No file bytes pass through the API. Works identically on MinIO (dev) and S3 (prod) with `@aws-sdk/client-s3`.
- **Cons:** More API endpoints to build (initiate, presign-parts, complete, abort). Client must track part ETags and send them on completion. No built-in cross-part progress tracking — client must implement it. Presigned URLs have expiry — long uploads on slow connections may need URL regeneration. MinIO must be network-reachable from the client (CORS configuration required).

### Option B: tus Protocol (Resumable Uploads)
- Open protocol for resumable file uploads. A tus server (e.g., `tusd`) handles chunked uploads with automatic resume from any byte offset. Can use S3 as backend storage. Client uses tus protocol (POST to create, PATCH to send chunks, HEAD to check progress).
- **Pros:** Fine-grained resumability — resume from any byte offset, not just part boundaries. Accepts chunks as small as 1 byte (vs. S3's 5MB minimum parts). Vendor-neutral open protocol with client SDKs for JS, iOS, Android. Upload progress is server-tracked — client can resume without local state.
- **Cons:** Requires running a separate tus server (`tusd`) — new infrastructure component to deploy, configure, and maintain in Compose. When backed by S3, tusd internally maps tus operations to S3 multipart — the same S3 operations happen with an extra network hop. NestJS API must proxy or redirect to tusd — indirect integration. Overkill for a controlled environment where the only client is a first-party frontend.

### Option C: Single Presigned PUT URL
- Generate one presigned PUT URL per upload. The client uploads the entire file in a single HTTP PUT directly to MinIO.
- **Pros:** Simplest implementation — one API call to generate the URL, one PUT from the client. No multipart lifecycle. No part tracking.
- **Cons:** **Hard 5GB limit in the S3 protocol — cannot support 10GB files.** No parallelism — one connection, one stream. No partial retry — any network failure restarts the entire upload. Disqualified by the project's requirements.

**Recommendation:** **Option A (S3 Multipart via Presigned URLs)** — The only option that satisfies the 10GB requirement using the native S3 protocol without adding new infrastructure. Option C is disqualified by the 5GB hard limit. Option B adds a tusd server that internally wraps the same S3 multipart operations — extra infrastructure for a resumability benefit (sub-5MB granularity) that a controlled first-party frontend does not need. The multipart flow has more API surface, but each endpoint is straightforward and `@aws-sdk/client-s3` provides all required operations (`CreateMultipartUploadCommand`, presigned `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`).

**Decision:** A (S3 Multipart via Presigned URLs)

---

## TD-03: Video Streaming and Download Strategy

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Videos must start playing without full download (streaming) and users must be able to download the full file. MinIO (S3-compatible) is the storage backend. The API must validate authorization before granting access. The HTML5 `<video>` element natively handles HTTP range requests (206 Partial Content) when the server supports them — MinIO supports range requests on both direct and presigned GET URLs.

**Options:**

### Option A: Presigned GET URL Redirect (302)
- The API validates auth/permission, generates a short-lived presigned GET URL for the video object in MinIO, and returns a 302 redirect. The browser follows the redirect and issues range requests directly against MinIO. For download, the presigned URL includes a `response-content-disposition=attachment` parameter.
- **Pros:** Zero byte proxying through the API — MinIO serves video directly. MinIO handles range requests natively (206 Partial Content). API overhead is sub-millisecond (auth check + URL generation only). API bandwidth and CPU fully decoupled from video traffic. Browser `<video>` elements follow 302 redirects and issue Range requests transparently. Download uses the same mechanism with a Content-Disposition override.
- **Cons:** MinIO must be network-reachable from the client (requires exposing MinIO port or reverse proxy). Presigned URL is visible in browser network tab (mitigated by short 5–15 min expiry). CORS must be configured on MinIO for browser direct access. Short-lived URLs may expire during very long playback sessions (mitigated by re-requesting on 403).

### Option B: API Proxy Stream
- The API validates auth, fetches the video from MinIO using the S3 SDK, and pipes the byte stream to the HTTP response. The API implements Range header parsing, requests the corresponding byte range from MinIO, and returns 206 responses.
- **Pros:** MinIO is fully hidden from clients — no external exposure needed. No CORS configuration needed on MinIO. Full control over response headers, caching, and access logging.
- **Cons:** **Every video byte flows through the API server** — CPU, memory, and network bandwidth consumed for every stream. API becomes the bottleneck for all video traffic. Must implement Range header parsing, byte-range S3 requests, and 206 response assembly manually. Defeats the purpose of using object storage (offloading static file serving). Significantly higher cost to scale.

### Option C: HLS/DASH Transcoding
- The worker transcodes uploaded videos into HLS segments (`.m3u8` manifest + `.ts` segments) at multiple renditions. The client uses an HLS player (hls.js) for adaptive-bitrate streaming. Segments are served from MinIO.
- **Pros:** Adaptive bitrate — automatically adjusts quality to network conditions. Industry standard for professional platforms. CDN-friendly (static segment files).
- **Cons:** Massive scope expansion: transcoding pipeline, multiple renditions (360p, 720p, 1080p), segment generation, manifest management. Dramatically longer processing time per video. 3–5x more storage per video. Requires HLS player integration in the frontend. The requirement is "streaming without full download", not adaptive bitrate — far exceeds the scope.

**Recommendation:** **Option A (Presigned GET URL Redirect)** — Meets the streaming requirement with minimal implementation: the API generates a presigned URL and redirects; MinIO handles byte serving natively. The browser's `<video>` element + MinIO's range request support provide streaming out of the box. Option B wastes API resources proxying bytes that MinIO serves directly. Option C is a significant scope expansion (transcoding pipeline, multi-rendition storage, HLS player) that the requirements do not call for.

**Decision:** A (Presigned GET URL Redirect)

---

## TD-04: Worker Architecture

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Video processing (FFmpeg metadata extraction, thumbnail generation) is CPU-bound and must not impact API response times (requirement: "sem impacto na performance"). The worker consumes jobs from the queue (TD-01). The project is a NestJS monorepo with a single backend codebase (`nestjs-project/`). FFmpeg must be available in the worker's runtime environment but is not needed by the API.

**Options:**

### Option A: Separate Container, Same Codebase
- Same `nestjs-project/` codebase with a dedicated `worker.main.ts` entry point. The worker boots via `NestFactory.createApplicationContext()` (no HTTP listener) and registers only BullMQ processors. A separate Compose service (`nestjs-worker`) runs a container built from the same Dockerfile (or a variant with FFmpeg installed) with a different command. Shared entities, services, and config — DRY.
- **Pros:** Resource isolation — FFmpeg CPU spikes do not affect API latency. Independent scaling (different CPU/memory limits per container). Shared codebase — entities, DTOs, services, config are not duplicated. FFmpeg installed only in the worker image — API image stays lean. Clear separation of concerns.
- **Cons:** Two containers to manage in Compose. May need a variant Dockerfile or multi-stage build for the worker (FFmpeg install). Two processes to monitor. Must ensure shared modules work in both HTTP app context and standalone context.

### Option B: In-Process (Same Container as API)
- The API process also runs BullMQ processors. `@Processor()` handlers register in the same NestJS application. FFmpeg installed in the API container.
- **Pros:** Simplest setup — one container, one process, one entry point. No separate Compose service. Fewer moving parts.
- **Cons:** **FFmpeg CPU usage directly impacts API response times** — violates the "sem impacto na performance" requirement. No resource isolation. FFmpeg bloats the API image unnecessarily. Cannot scale API and worker independently. API restarts kill in-progress processing jobs.

### Option C: Separate Codebase
- A completely independent project directory for the worker, with its own `package.json`, TypeScript config, and entity definitions. Connects to the same database and queue.
- **Pros:** Complete independence — worker can evolve independently. Clean deployment boundary.
- **Cons:** Entity and DTO duplication across two projects — video entity, status enum, config schemas maintained in two places. Schema drift risk (API adds a column, worker's copy lags). Violates DRY significantly. Higher maintenance cost for an MBA project where both sides are NestJS + TypeScript.

**Recommendation:** **Option A (Separate Container, Same Codebase)** — Resource isolation is essential (the requirement explicitly says "sem impacto na performance"), ruling out Option B. Option C's full independence creates duplication overhead with no benefit — the worker is NestJS, shares entities, and connects to the same database. A shared codebase with a dedicated entry point (`worker.main.ts` using `NestFactory.createApplicationContext()`) provides isolation without duplication.

**Decision:** A (Separate Container, Same Codebase)

---

## TD-05: Unique Video URL Generation

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short, unique, URL-safe identifier (slug) for public-facing URLs (e.g., `/videos/dQw4w9WgXcQ`). The identifier is stored in the videos table with a unique constraint. The strategy affects URL aesthetics, collision probability, and database indexing.

**Options:**

### Option A: nanoid (11 characters)
- Generates URL-safe random strings using a 64-symbol alphabet (`A-Za-z0-9_-`). With 11 characters: ~66 bits of entropy. At 1,000 videos/hour, ~139 years to reach 1% collision probability. Zero dependencies; ~45M weekly downloads.
- **Pros:** YouTube-style short IDs (`dQw4w9WgXcQ`). URL-safe by default — no encoding needed. Compact (11 chars vs 36 for UUID). Negligible collision risk at any realistic scale. No runtime dependencies. Widely adopted and actively maintained.
- **Cons:** Not monotonically increasing — B-tree index locality is suboptimal (irrelevant for the small table size of a video platform). Requires a unique constraint + application-level retry on the astronomically unlikely collision. No embedded timestamp — cannot sort by creation from the ID alone.

### Option B: UUIDv4
- Standard 128-bit random identifier formatted as `550e8400-e29b-41d4-a716-446655440000`. Native support in PostgreSQL (`gen_random_uuid()`), Node.js (`crypto.randomUUID()`), and TypeORM.
- **Pros:** Virtually zero collision probability (122 bits of entropy). Native PostgreSQL `uuid` type with optimized storage and indexing. No external dependency. Universal standard.
- **Cons:** 36 characters in URL — long and unfriendly for sharing (`/videos/550e8400-e29b-41d4-a716-446655440000`). Contains hyphens. Not human-memorable or typeable. Overkill entropy (122 bits when ~66 suffice for any video platform scale).

### Option C: Sqids (formerly Hashids)
- Encodes numeric database IDs into short, YouTube-like strings. Deterministic and reversible — same input always produces the same output, and the original number can be decoded.
- **Pros:** Short, readable IDs. Deterministic from sequential DB IDs — no collision by design. Can decode back to the original ID (useful for debugging).
- **Cons:** Encoding is reversible, not encrypted — sequential IDs are exposed. Attacker can decode a slug to guess adjacent video IDs (enumeration risk). Requires maintaining an encoding secret/salt. Contradicts the spirit of "unique URL without conflict" — the uniqueness is delegated to the DB sequence rather than intrinsic randomness.

**Recommendation:** **Option A (nanoid, 11 characters)** — Produces YouTube-style short URLs that are URL-safe, compact, and have negligible collision probability at any realistic scale. UUIDv4's 36-character format creates poor sharing URLs for a video platform. Sqids' reversibility introduces enumeration risk. nanoid's ~66 bits of entropy are sufficient, and the library has zero dependencies with a large, actively maintained ecosystem.

**Decision:** A (nanoid, 11 characters)

---

## TD-06: Video Processing Tooling (FFmpeg Wrapper)

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker (TD-04) must extract video metadata (duration, resolution, codec) via `ffprobe` and generate a thumbnail by capturing a frame at a specific timestamp via `ffmpeg`. FFmpeg and ffprobe are installed natively in the worker container. The decision is whether to use a high-level Node.js wrapper library or invoke FFmpeg directly via `child_process`.

**Options:**

### Option A: fluent-ffmpeg
- High-level Node.js wrapper around the FFmpeg CLI. Provides a chainable API: `.input()`, `.outputOptions()`, `.on('end')`, `.on('error')`. Includes `ffprobe()` helper returning structured metadata. ~1.2M weekly downloads.
- **Pros:** Readable chainable API — e.g., `.input(file).screenshots({ count: 1, timestamps: ['50%'] })`. Built-in `ffprobe()` wrapper returns structured JSON metadata (duration, streams, format). Event-based progress tracking (`on('progress')`). Handles argument escaping and path resolution. Large community with examples for common operations.
- **Cons:** Maintenance risk — the project README notes it is looking for new maintainers; last major release (2.1.x) dates from 2019. Stable but not actively developed. Adds a runtime dependency for what is essentially argument assembly + child process spawning. Abstracts away FFmpeg CLI flags — debugging requires understanding both the wrapper API and the underlying command.

### Option B: Direct child_process (thin in-house wrapper)
- Invoke `ffmpeg` and `ffprobe` directly via Node.js `child_process.execFile()`. Build a thin async/promise-based wrapper for the two specific operations needed: metadata extraction (`ffprobe -print_format json -show_streams -show_format`) and thumbnail capture (`ffmpeg -ss <time> -i <input> -frames:v 1`).
- **Pros:** Zero external dependency — uses only Node.js built-ins. Full control over FFmpeg CLI flags — direct mapping to FFmpeg documentation. Trivial to maintain — the wrapper is ~50–80 lines for two operations. No third-party maintenance risk. Easy to audit, test, and extend.
- **Cons:** Must handle argument construction and error parsing manually. No built-in progress events (must parse stderr if needed). Slightly more initial boilerplate. Less discoverable API — developers must know FFmpeg CLI flags.

**Recommendation:** **Option B (Direct child_process)** — The worker needs exactly two FFmpeg operations: `ffprobe` for metadata and `ffmpeg` for a single thumbnail frame. A thin async wrapper around `child_process.execFile()` is ~50–80 lines, zero dependencies, and maps directly to FFmpeg documentation. fluent-ffmpeg's rich API (transcode, watermark, concat, streaming) is unused, and its uncertain maintenance status is a risk for a greenfield project. The simpler solution is easier to audit, test, and maintain for the narrow scope of operations needed.

**Decision:** B (Direct child_process)

---

## TD-07: Video Status Lifecycle and Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Multiple capabilities reference different lifecycle stages — draft (pre-registration on upload initiation), processing (automatic after upload), and ready/error (processing outcome). The acceptance criteria explicitly require "rascunho → processando → pronto/erro refletido no banco", and `desafio/escopo.md` lists the status lifecycle and failure handling as a research decision. The status enum is referenced across the video entity, DTOs, worker processor, API responses, and queue job handlers — a cross-component contract within the backend. The key questions are: which states exist, what transitions are valid, and what happens when processing fails permanently (after BullMQ exhausts retries per TD-01).

**Options:**

### Option A: Minimal 4-State, No Error Metadata
- States: `draft` → `processing` → `ready` | `error`. The video is created as `draft` on upload initiation. When the client completes the multipart upload (TD-02), the API enqueues a BullMQ job and sets status to `processing`. The worker sets `ready` on success or `error` when BullMQ exhausts its configured retry attempts.
- **Pros:** Matches acceptance criteria verbatim. Simplest implementation — 4 enum values, linear transitions with one branch. BullMQ's built-in retry/backoff (TD-01) handles transient failures transparently. Fewer state transitions to implement and test.
- **Cons:** No failure diagnosis on the video entity — must query BullMQ job data or dashboard to understand why a video failed. API cannot expose error details to the user without coupling to BullMQ internals. No distinction between "permanently failed" and "transient error" from the entity alone.

### Option B: 4-State with Error Metadata
- Same 4 states as Option A (`draft` → `processing` → `ready` | `error`), but the video entity adds an `error_reason` nullable text column. On permanent failure (BullMQ `failed` event with attempts exhausted), the worker writes the failure reason (e.g., "Invalid video format", "FFmpeg timeout") to the entity alongside the `error` status. The column is `null` for all non-error states. Manual reprocessing: an API endpoint can re-enqueue `error` videos (new BullMQ job, status back to `processing`, `error_reason` cleared).
- **Pros:** Self-contained failure diagnosis — API can return error details without BullMQ dashboard dependency. Same simple 4-state model as Option A. Minimal schema impact (one nullable column). Enables user-facing error messages in future phases (e.g., "Your video could not be processed: invalid format").
- **Cons:** `error_reason` is mostly null (only populated on failure). Duplicates information available in BullMQ's job metadata. Requires the worker to format human-readable error messages.

### Option C: 5-State with Queued Stage and Error Metadata
- States: `draft` → `queued` → `processing` → `ready` | `error`. Adds a `queued` state between upload completion and worker pickup. The API sets `queued` when it enqueues the BullMQ job. The worker sets `processing` when it picks up the job (via `@OnWorkerEvent('active')` or at processor entry). Includes `error_reason` column as in Option B.
- **Pros:** Distinguishes "waiting in queue" from "actively being processed" — better observability for debugging and user feedback. Enables accurate progress indicators (e.g., "Your video is #3 in the queue" vs. "Processing now..."). Error metadata included.
- **Cons:** More states = more transitions to implement and test. The `queued → processing` transition requires BullMQ worker event listener boilerplate. In a single-worker setup, the `queued` state may last milliseconds — complexity for minimal practical value. The queued/active distinction is already tracked internally by BullMQ's own job states.

**Recommendation:** **Option B (4-State with Error Metadata)** — Matches the acceptance criteria's explicit 4-state model (rascunho → processando → pronto/erro) while providing self-contained failure diagnosis via `error_reason`. Option A's lack of error metadata forces BullMQ dashboard dependency for failure diagnosis — a coupling that leaks queue internals into operational workflows. Option C's `queued` state duplicates BullMQ's internal job tracking and adds transition complexity with negligible value in a single-worker architecture. The `error_reason` column is a single nullable field that enables future user-facing error messages without schema changes.

**Decision:** B (4-State with Error Metadata)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue Technology | BullMQ + Redis | A (BullMQ + Redis) |
| TD-02 | Cross-layer | Upload Strategy for Large Files (10GB) | S3 Multipart via Presigned URLs | A (S3 Multipart via Presigned URLs) |
| TD-03 | Cross-layer | Video Streaming and Download Strategy | Presigned GET URL Redirect | A (Presigned GET URL Redirect) |
| TD-04 | Backend | Worker Architecture | Separate Container, Same Codebase | A (Separate Container, Same Codebase) |
| TD-05 | Backend | Unique Video URL Generation | nanoid (11 chars) | A (nanoid, 11 chars) |
| TD-06 | Backend | Video Processing Tooling | Direct child_process wrapper | B (Direct child_process) |
| TD-07 | Backend | Video Status Lifecycle and Failure Handling | 4-State with Error Metadata | B (4-State with Error Metadata) |
