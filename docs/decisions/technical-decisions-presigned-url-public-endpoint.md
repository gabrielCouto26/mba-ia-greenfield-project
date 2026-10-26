---
scope_type: ad-hoc
related_phases: [3]
status: decided
date: 2026-10-26
scope_description: "Public-reachable endpoint for presigned S3/MinIO URLs so external clients (browser, frontend, host curl) can consume upload PUT, stream/download GET, and thumbnail URLs that are currently signed with the Docker-internal host minio:9000."
---

# Technical Decisions — Public Endpoint for Presigned URLs (MinIO/S3)

_Subprojects in scope:_

- `nestjs-project/` — backend API and worker. The fix is confined to S3 config (`src/config/s3.config.ts`), the storage service (`src/videos/services/storage.service.ts`), the env schema (`src/config/env.validation.ts`), and `.env`/`.env.example`, plus the storage specs. No worker business-logic change — the worker only performs server-side operations (`downloadFile`, `uploadFile`) that keep using the internal host.
- `next-frontend/` — not initialized; no implementation here. The decision is a behavioral prerequisite for the frontend to consume the Phase 03 presigned URLs (it will receive working URLs and fetch them transparently), but requires no frontend code and forces no frontend design choice. No open decision in this document.

> **Relationship to Phase 03.** This is complementary per-topic research for `technical-decisions-phase-03-videos.md` (which is already `decided`). It does not reopen that document. It makes TD-02 (upload via presigned multipart PUT) and TD-03 (streaming/download via 302 → presigned GET) actually reachable from an external client — today every presigned URL is signed with `minio:9000`, which only resolves inside the Docker network.

> **Tooling note (context7).** `CLAUDE.md` mandates library lookups via the context7 MCP tool; context7 is **not available** in this environment. Installed versions were read directly from the backend lockfile (`@aws-sdk/client-s3` **3.1152.0**, `@aws-sdk/s3-request-presigner` **3.1152.0**, `joi` **18.1.2**, `@nestjs/config` **4.0.3**) and the presigner behavior was cross-referenced via web search of AWS documentation. Flagging the unavailability per the research discrepancy rule; re-verify against context7 if it becomes available before implementation.

---

## TD-01: Presign Endpoint Strategy (internal host vs public host)

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Every presigned URL is currently signed with `S3_ENDPOINT=http://minio:9000` — the Compose service name, which only resolves inside the Docker network (`s3.config.ts:4`, `storage.service.ts:28-36`). Any client outside Docker (browser, frontend, host `curl`) cannot reach these URLs, breaking the acceptance criterion "Streaming funcionando … e download disponível" (`desafio/criterios-de-aceite.md:16`) for real external clients. The URL **cannot** be rewritten after signing: SigV4 signs the `host` header (`X-Amz-SignedHeaders=host`), so replacing `minio:9000` with `localhost:9000` in the string yields `SignatureDoesNotMatch`. Affected sites (all consumed by an external client): `getPresignedPartUrl` (upload PUT), `getStreamUrl` and `getDownloadUrl` (302 → GET), and the embedded `thumbnail_url` in `findByPublicId`. Presigning is a pure local SigV4 computation (no network to the signed host, given this project's static credentials), which is what makes signing with a public host from inside the container possible.

**Options:**

### Option A: Split endpoint — internal client + public presigner
- Keep the existing `S3Client` on the internal host (`minio:9000`) for all server-side `send()` operations (create/complete/abort multipart, `uploadFile`, `downloadFile`). Introduce a `publicEndpoint` used **only** when generating presigned URLs, so the signed `Host` is the externally reachable host (`localhost:9000` in dev; the public S3/CDN domain in prod).
- **Pros:** Server-side operations keep the Docker-internal host — honors the hard Docker rule ("never localhost inside containers"). Presigned URLs become reachable by any external client with a valid signature. Maps cleanly to production, where `publicEndpoint` is the real S3/CDN domain and the internal host simply disappears. Change is isolated to `StorageService` + config.
- **Cons:** Two endpoint notions to keep straight (internal vs public). Requires a second client or per-call wiring (see TD-02). Specs must assert which operation uses which host.

### Option B: Single externally-resolvable hostname (host alias / reverse proxy)
- Use one endpoint hostname that resolves identically inside the Docker network and from the host — e.g., an alias mapping `minio` → `127.0.0.1` in each developer's `/etc/hosts`, or a reverse proxy fronting MinIO on a hostname both sides reach. No application code change; the signed host works everywhere.
- **Pros:** No dual-endpoint logic in code. One endpoint value. Server-side and client-side use the same URL.
- **Cons:** Requires host-level setup each developer must replicate (fragile, easy to forget, not captured by Compose), or a new reverse-proxy container (added infra). The alias trick is brittle across OSes and still needs port 9000 published. Does **not** reflect the production topology where the internal host is absent — it pushes a dev-only workaround onto every contributor's machine.

### Option C: Switch the single endpoint to the public host
- Change `S3_ENDPOINT` from `minio:9000` to `localhost:9000` for the one and only client.
- **Pros:** Trivial one-line env change; presigned URLs reachable from the host.
- **Cons:** **Breaks every server-side `client.send()`** (create/complete/abort/upload in the API, `downloadFile` in the worker) — inside a container `localhost` is the container itself, not MinIO. Directly violates the `CLAUDE.md` hard Docker rule. Disqualified.

**Recommendation:** **Option A (split endpoint)** — it is the only option that keeps server-side traffic on the Docker-internal host (respecting the Docker rule) while making presigned URLs reachable by external clients, and it is the one that degrades correctly into production (public domain for presigns, internal host gone). Option B exports an infra workaround to every machine and diverges from prod; Option C breaks all server-side S3 calls. The split applies to **all** presign sites — upload PUT included — because the multipart upload (phase-03 TD-02) is a client-direct PUT, so its client is external too.

**Decision:** A (split endpoint — internal client + public presigner)

---

## TD-02: Presigner Client Realization (dedicated client vs per-call override)

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Given Option A of TD-01, the split must be realized inside `StorageService`, which today holds a single `S3Client` (`storage.service.ts:21-38`). The question is how the presign methods (`getPresignedPartUrl`, `getPresignedGetUrl`) obtain a client bound to the public endpoint while the `send()`-based methods keep the internal one. In AWS SDK JS v3, `endpoint` is a client-construction option; `getSignedUrl(client, command, options)` options (`expiresIn`, etc.) do **not** include an endpoint.

**Options:**

### Option A: Dedicated second S3Client for presigning
- Construct a second `S3Client` in `StorageService` configured with `endpoint: config.publicEndpoint` (same region, credentials, `forcePathStyle: true`) and pass it to `getSignedUrl` in the two presign methods. The original client stays for all `send()` operations.
- **Pros:** Explicit and readable — the presigner client's single purpose is obvious. Each client is immutably bound to its endpoint, so a server-side call can never accidentally sign/connect with the public host. Trivial to unit-test (assert the presign client's resolved endpoint). Matches the SDK v3 model where endpoint is client config.
- **Cons:** Two client instances held in the service (negligible overhead). Minor construction duplication — mitigated by a small private factory.

### Option B: Per-call endpoint override
- Keep a single client and override the endpoint per presign call — in v3 this requires config mutation or per-request endpoint middleware, since `getSignedUrl` exposes no endpoint option.
- **Pros:** A single client instance.
- **Cons:** No first-class per-call endpoint hook on `getSignedUrl`; achieving it needs fragile middleware or shared-config mutation that risks leaking the public endpoint into server-side calls (and vice versa). Harder to test and reason about. Contradicts the SDK's "endpoint is client config" design.

**Recommendation:** **Option A (dedicated second client)** — explicit, immutable endpoint binding eliminates the class of bug where a server-side operation signs with the public host or a presign uses the internal one, and it is directly unit-testable. The per-call override has no clean v3 API and trades a negligible memory saving for real correctness and testability risk.

**Decision:** A (dedicated second S3Client)

---

## TD-03: `S3_PUBLIC_ENDPOINT` Default and Validation

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The public endpoint is a new configuration value read in `s3.config.ts` and validated in `env.validation.ts` (Joi 18.1.2), and documented in `.env.example` — a cross-component contract (schema + config + env example must agree). The decision is the default/fallback behavior and whether the variable is required, which governs whether existing environments regress when they do not set it.

**Options:**

### Option A: Optional var, fallback to `S3_ENDPOINT`
- `publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || 'http://minio:9000'`. Joi: `S3_PUBLIC_ENDPOINT: Joi.string().uri().optional()`. Document `S3_PUBLIC_ENDPOINT=http://localhost:9000` in `.env.example`.
- **Pros:** Safe — environments that do not set it keep today's behavior (no regression / no startup break). Explicit opt-in to the public host. Production sets it to the real domain. Mirrors how `S3_ENDPOINT` already defaults.
- **Cons:** A developer who forgets to set it in dev still gets Docker-internal URLs — but that is exactly the pre-fix state, and `.env.example` documents the value to set.

### Option B: Default to `localhost:9000`
- `publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:9000'`.
- **Pros:** Works out of the box for local host testing with zero config.
- **Cons:** Wrong default for any non-localhost deployment; silently bakes a dev assumption into the code. Staging/prod must always override or presigns break. Diverges from the `S3_ENDPOINT` fallback chain.

### Option C: Required var
- `S3_PUBLIC_ENDPOINT: Joi.string().uri().required()`.
- **Pros:** Forces an explicit, conscious value in every environment; no hidden fallback.
- **Cons:** Breaks startup for every existing `.env` that lacks it — a regression for the currently-working infra. Heavier than warranted for a value that has a sensible fallback.

**Recommendation:** **Option A (optional, fallback to `S3_ENDPOINT`)** — it ships the fix with zero regression risk (unset → current behavior), keeps dev onboarding a one-line `.env.example` entry, and lets prod point at the real S3/CDN domain. The `.uri()` constraint catches malformed values without making the var mandatory. Required (C) needlessly breaks existing environments; a hard `localhost` default (B) is wrong everywhere but a local host.

**Decision:** A (optional, fallback to `S3_ENDPOINT`)

---

## Notes (not decisions)

- **Scope boundary — real range/206 streaming.** Byte-range streaming semantics are out of scope here; phase-03 TD-03 stays at 302 → presigned GET, and MinIO serves range requests natively against that URL. This document only establishes that a **public endpoint is the prerequisite** for an external client to follow that redirect successfully.
- **Precondition already satisfied.** `localhost:9000` from the host works because MinIO's port 9000 is already published in Compose — no infra/compose change is needed for dev.
- **`forcePathStyle: true` interaction.** The client uses path-style addressing, so the bucket lives in the path (`http://<host>:9000/streamtube/<key>`). Switching only the host avoids the known virtual-host "duplicated bucket subdomain" pitfall reported for custom endpoints in the AWS SDK v3 — the split changes the host, not the addressing style.
- **Test workaround (manual only).** `curl --resolve minio:9000:127.0.0.1 …` connects to 127.0.0.1 while preserving `Host: minio:9000`, keeping the signature valid. Useful to demonstrate the current gap; not a solution.

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Presign Endpoint Strategy (internal vs public) | A (split endpoint — internal client + public presigner) | A |
| TD-02 | Backend | Presigner Client Realization | A (dedicated second S3Client) | A |
| TD-03 | Backend | `S3_PUBLIC_ENDPOINT` Default and Validation | A (optional, fallback to `S3_ENDPOINT`) | A |
