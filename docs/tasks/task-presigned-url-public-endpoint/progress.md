---
kind: progress
task: task-presigned-url-public-endpoint
---

# task-presigned-url-public-endpoint — Progress

## Status: complete

## SI-1 — Configurar endpoint público para presigning (config + env + Joi)

**Status:** done

**Files changed:**
- `nestjs-project/src/config/s3.config.ts` — added `publicEndpoint` field (`S3_PUBLIC_ENDPOINT || S3_ENDPOINT || 'http://minio:9000'`)
- `nestjs-project/src/config/env.validation.ts` — added `S3_PUBLIC_ENDPOINT: Joi.string().uri().optional()`
- `nestjs-project/.env.example` — documented `S3_PUBLIC_ENDPOINT=http://localhost:9000` with explanation
- `nestjs-project/.env` — set `S3_PUBLIC_ENDPOINT=http://localhost:9000` for local dev

**Observations:**
- Fallback chain: `S3_PUBLIC_ENDPOINT || S3_ENDPOINT || 'http://minio:9000'` — unset behaves identically to before (zero regression)
- Joi `.uri().optional()` rejects malformed values on startup without breaking existing deploys

---

## SI-2 — Cliente presigner dedicado + reescrever presigns no StorageService

**Status:** done

**Files changed:**
- `nestjs-project/src/videos/services/storage.service.ts` — added `presignerClient: S3Client` (bound to `config.publicEndpoint`); switched `getPresignedPartUrl` and `getPresignedGetUrl` to use `presignerClient`; all `send()`-based ops remain on `client`
- `nestjs-project/src/videos/services/storage.service.spec.ts` — **new** unit test: asserts internal client → `S3_ENDPOINT`, presigner client → `S3_PUBLIC_ENDPOINT`, fallback when `S3_PUBLIC_ENDPOINT` is unset (4 tests)
- `nestjs-project/src/videos/services/storage.service.integration-spec.ts` — updated: all presigned URL assertions now check `new URL(url).hostname === publicHostname`; `completeMultipartUpload` uses an internal-client presigned URL (via `internalTestClient`) for the part PUT so the fetch works inside Docker; the public presign URLs carry `localhost` and have valid SigV4 params

**Observations:**
- MinIO validates the SigV4 Host header — URL hostname cannot be rewritten in integration tests; `internalTestClient` pattern solves this cleanly without polluting production code
- Unit tests use direct config injection (`provide: s3Config.KEY, useValue: ...`) instead of env-var manipulation, making them deterministic and isolated
- 197 unit+integration tests green, 77 E2E tests green, `tsc --noEmit` exits 0, lint exits 0 (0 errors, pre-existing warnings unchanged)

---

## Definition of Done

- [x] SI-1 — config publicEndpoint + env + Joi
- [x] SI-2 — presignerClient + rewrite presigns in StorageService
- [x] Backend unit + integration tests pass (33 suites, 197 tests — `--runInBand`)
- [x] E2E tests pass (8 suites, 77 tests)
- [x] TypeScript compiles cleanly (`npx tsc --noEmit` = 0 errors)
- [x] Lint passes (`npm run lint` = 0 errors)
- [ ] Manual: from the host (outside Docker), `GET /videos/:publicId/stream`, `/download`, thumbnail URL, and `presign-part` PUT open without `curl --resolve`
