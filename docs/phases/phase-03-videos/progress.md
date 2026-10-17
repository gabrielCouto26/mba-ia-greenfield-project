# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 5/9 completed

### SI-03.1 — Infraestrutura: Docker Compose (Redis, MinIO) + config modules
- **Status:** completed
- **Tests:** 4 passing
- **Observations:** none

### SI-03.2 — Entidade Video + migração + módulo
- **Status:** completed
- **Tests:** 5 passing
- **Observations:**
  - Created `.env` from `.env.example` (with S3 and Redis vars added) — required for migration:generate CLI to connect to the DB service inside the container.
  - Migration generated via CLI then trimmed to only the `videos` table — the CLI produced a full diff against an empty DB, but previous migrations already cover users/channels/auth tokens.
  - Module spec requires `User`, `Channel`, and `Video` in the `TypeOrmModule.forRoot` entities array because TypeORM validates all sides of declared relations at DataSource initialization.

### SI-03.3 — Upload iniciar (POST /videos)
- **Status:** completed
- **Tests:** 4 unit passing (videos.service.spec.ts) + 4 E2E passing (videos-upload-initiate.e2e-spec.ts); storage.service.integration-spec.ts skipped (requires MinIO container)
- **Observations:**
  - Added `transformIgnorePatterns: ["/node_modules/(?!(nanoid)/)"]` to both `package.json` Jest config and `test/jest-e2e.json` — nanoid v5 is ESM-only and was crashing ts-jest without this.
  - Added `s3Config` and `redisConfig` to `AppModule.ConfigModule.forRoot({ load: [...] })` — they were missing and required for `StorageService` injection.
  - E2E test overrides `StorageService` with a mock (MinIO image `minio/minio` is not pullable in this environment); `storage.service.integration-spec.ts` uses `jest.setTimeout(30000)` and requires `docker compose up -d minio` to run.
  - Error envelope field is `error` (not `errorCode`) per `DomainExceptionFilter` — spec was generated with wrong field name; test corrected to match actual project convention (`ApiErrorEnvelope.error`).

### SI-03.4 — Upload gerenciamento: presign-part + abort
- **Status:** completed
- **Tests:** 12 unit passing (videos.service.spec.ts) + 7 E2E passing (videos-upload-management.e2e-spec.ts); storage.service.integration-spec.ts skipped (requires MinIO container)
- **Observations:**
  - StorageService extended with `getPresignedPartUrl` (UploadPartCommand + `getSignedUrl` from `@aws-sdk/s3-request-presigner`) and `abortMultipartUpload` (AbortMultipartUploadCommand).
  - E2E test overrides StorageService with a mock (same pattern as SI-03.3) since MinIO is not available in this environment.

### SI-03.5 — Infraestrutura BullMQ
- **Status:** completed
- **Tests:** 1 passing
- **Observations:**
  - Installed `ioredis` explicitly — bullmq v6 treats it as an optional peer dep and throws "could not load ioredis" at runtime without it.
  - Extended `transformIgnorePatterns` in both `package.json` and `test/jest-e2e.json` to include `@nestjs/bullmq|@nestjs/bull-shared|bullmq` (same ESM-in-Jest pattern as nanoid, established in SI-03.3).
  - Module compilation test uses `lazyConnect: true` in `BullModule.forRoot` so the spec does not attempt a real Redis connection; the test only verifies DI wiring.

### SI-03.6 — Upload complete (POST /videos/:publicId/upload/complete)
- **Status:** completed
- **Tests:** 17 unit passing (videos.service.spec.ts) + 3 E2E passing (videos-upload-complete.e2e-spec.ts); storage.service.integration-spec.ts extended (completeMultipartUpload test requires MinIO container)
- **Observations:**
  - `getQueueToken('video-processing')` from `@nestjs/bullmq` used in unit test to provide the mock queue — matches the `@InjectQueue` token used by `VideosService`.
  - E2E overrides both `StorageService` and the BullMQ queue token with mocks (same pattern as SI-03.3/03.4 for MinIO); the queue mock's `add` call is inspected directly to verify job payload instead of hitting real Redis.
  - Storage integration test for `completeMultipartUpload` uses `fetch` to upload a 1-byte part to get a real ETag from MinIO — MinIO allows sub-5MiB parts in test scenarios (S3 production requires ≥5MiB per part except the last).

### SI-03.7 — Video processing worker (FFmpeg + BullMQ consumer)
- **Status:** pending
- **Tests:** 
- **Observations:** none

### SI-03.8 — Streaming + download
- **Status:** pending
- **Tests:** 
- **Observations:** none

### SI-03.9 — Video info (GET /videos/:publicId)
- **Status:** pending
- **Tests:** 
- **Observations:** none
