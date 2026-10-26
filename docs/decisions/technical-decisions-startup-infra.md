---
scope_type: ad-hoc
related_phases: [3]
status: decided
date: 2026-10-26
scope_description: "Docker startup/infra reliability for the Phase 03 video stack: deterministic MinIO bucket provisioning, worker entity-graph registration, and node_modules isolation so a clean `docker compose up` is operational on any host."
---

# Technical Decisions — Startup & Infra Reliability (Phase 03 Docker Stack)

_Subprojects in scope:_

- `nestjs-project/` — the Docker Compose stack (`compose.yaml`), the two runtime Dockerfiles (`Dockerfile.dev`, `Dockerfile.worker`), the standalone worker composition (`src/worker.module.ts`), and environment declaration (`.env.example` / Joi schema). All decisions in this document live here.
- `next-frontend/` — not involved. These are backend infrastructure/startup concerns with no frontend surface; no open decision in this document.

---

## Context — the observed problem

Bringing the stack up with `docker compose up -d` from a clean clone does not leave the Phase 03 environment operational. Three independent startup/infra gaps surfaced, each with more than one reasonable remedy:

1. **MinIO boots empty** — no step creates the `streamtube` bucket, so every storage operation (upload initiate, presign, worker thumbnail write, streaming redirect) fails.
2. **The worker fails to initialize its DataSource** — `WorkerModule` cannot build the `Video` entity's relation graph (`Video` → `Channel` → `User`) because those related entities are not registered in the worker's Nest context.
3. **The source bind mount shadows the image's `node_modules`** — mounting the host working directory over `/home/node/app` overlays (and thus hides) any `node_modules` baked into the image with the host's copy, which may be missing or built for a different OS/architecture, breaking `nest`, the AWS SDK, BullMQ, migrations, and both `start:*` scripts.

Each gap below is framed as a decision with trade-offs, not a mechanical patch. A by-design behavior is explicitly **out of scope**: the stack is meant to boot only infrastructure, leaving `nestjs-api`/`nestjs-worker` idle (`tail -f /dev/null`) while the server, worker, and migrations are started manually (`nestjs-project/CLAUDE.md`). These TDs make that idle-but-ready state actually reachable from a clean clone — they do not change the manual-start design.

---

## TD-01: MinIO Bucket Provisioning at Compose Startup

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** MinIO starts with no buckets. The storage capability — used by upload initiation, part presigning, the worker's thumbnail write, and streaming/download redirects — requires the `streamtube` bucket to exist before the first request. A clean `docker compose up -d` must leave the bucket present deterministically, without a manual step. The provisioning step and the runtime config must read the **same** S3 identity (endpoint, bucket, credentials); those keys already exist in `s3.config.ts` and the Joi schema (`src/config/env.validation.ts`), so whichever option is chosen, the S3 (and Redis) keys must also be declared in `.env.example` so a fresh clone defines them and the bucket name cannot drift between the provisioning step and `s3.config.ts`.

**Options:**

### Option A: Dedicated ephemeral `minio-init` service
- A one-shot Compose service built on an image that ships the MinIO client (`mc`), depending on `minio` with `condition: service_healthy`, that runs `mc mb --ignore-existing local/$S3_BUCKET` and exits. `nestjs-api` and `nestjs-worker` gate on it with `condition: service_completed_successfully`.
- **Pros:** Declarative and idempotent; provisioning is a visible, discrete startup step; a non-zero exit blocks dependents instead of failing silently later; keeps the `mc` tooling out of the runtime images; reuses the same client MinIO's own healthcheck already uses; bucket name comes from `$S3_BUCKET`, so it stays in lockstep with runtime config.
- **Cons:** Adds one Compose service and an `mc`-capable image pull; needs S3 credentials via `env_file`.

### Option B: Application-level "ensure bucket" on startup
- `StorageService` checks for the bucket (`HeadBucket`) and creates it (`CreateBucket`) during module initialization, in both the API and worker.
- **Pros:** No extra Compose service; provisioning logic colocated with the storage code; works in any environment, including production, with no Compose dependency.
- **Cons:** API and worker race to create the same bucket on boot (needs idempotent "already-exists" handling); couples application startup to storage provisioning, so a storage hiccup delays or fails app boot; mixes infrastructure provisioning into a runtime business service (SRP tension); the provisioning is no longer an observable, standalone step.

### Option C: Entrypoint/command override on an existing service
- Fold `mc mb` into a shell entrypoint on an existing service (e.g., wrap the API entrypoint, or extend MinIO's own `command`).
- **Pros:** No new dedicated service in the file.
- **Cons:** Overloads a service's entrypoint with unrelated provisioning; MinIO's image entrypoint is the server process, so wrapping it is fragile; ordering and readiness semantics are muddier than an explicit `service_completed_successfully` gate; concern-mixing makes the file harder to read.

**Recommendation:** **Option A (dedicated `minio-init`)** — a one-shot init container is the canonical Compose idiom for provisioning, and `service_completed_successfully` gives API and worker a clean happens-before guarantee without either racing to create the bucket. It keeps `mc` out of the runtime images, stays idempotent via `--ignore-existing`, and derives the bucket name from `$S3_BUCKET` so it cannot drift from `s3.config.ts`. Option B leaks infra provisioning into a runtime service and needs race handling; Option C overloads an unrelated service's entrypoint. (Whichever is chosen, the S3/Redis keys must be present in `.env.example` and the Joi schema so a clean clone resolves them — hosts named by Compose service, `minio`/`redis`, never `localhost`.)

**Decision:** A

---

## TD-02: Worker Entity-Graph Registration

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker runs as a standalone Nest context (`WorkerModule`, bootstrapped without an HTTP listener) and updates the `Video` entity after processing. `Video` holds a `ManyToOne` to `Channel`, and `Channel` a `ManyToOne` to `User`. The worker's `TypeOrmModule.forRootAsync` uses `autoLoadEntities: true`; per `.claude/rules/nestjs-modules.md`, with `autoLoadEntities` an entity is discovered **only** if some module registers it via `forFeature`. `WorkerModule` registers only `Video`, so `Channel` and `User` are absent from the DataSource and TypeORM cannot resolve `Video`'s relation metadata at boot. The worker needs the `Video` repository for writes; it needs `Channel`/`User` only as relation metadata, not as injected repositories. (Installed: `@nestjs/typeorm@^11.0.1`, `typeorm@^0.3.28` — `autoLoadEntities` + `forFeature` discovery behaves as the rule describes.)

**Options:**

### Option A: Register the three entities via `forFeature([Video, Channel, User])`
- Add `Channel` and `User` to the worker's existing `TypeOrmModule.forFeature`.
- **Pros:** One line; uses exactly the discovery mechanism the project rule mandates ("every entity must be registered in `forFeature`… even with `autoLoadEntities`"); minimal surface; keeps the worker's discovery strategy identical to the API's; pulls in no extra providers.
- **Cons:** Registers `Channel`/`User` repositories the worker never injects (inert, but present); the worker module names entities owned by other domains — a mild SRP tension, acceptable for a read/relation context.

### Option B: Import the owning domain modules (`VideosModule`, `ChannelsModule`, `UsersModule`)
- Let each domain module register its own entity by importing the modules into `WorkerModule`.
- **Pros:** Respects entity ownership — each `forFeature` stays in its own module; the worker module names no foreign entities.
- **Cons:** Imports each module's full provider (and controller) graph into the worker context for what is only metadata; heavier boot; risks instantiating HTTP-oriented providers in a context that has no HTTP; over-couples the worker to entire domain modules.

### Option C: Explicit `entities: [...]` list, dropping `autoLoadEntities` in the worker
- Pass `entities: [Video, Channel, User]` to the worker's `forRootAsync` and keep `forFeature([Video])` only for the repository.
- **Pros:** Cleanly separates DataSource metadata (explicit list) from repository injection (just `Video`); self-documenting for a standalone context; registers no foreign repositories.
- **Cons:** Introduces a second entity-discovery convention in one codebase (API keeps `autoLoadEntities: true`, worker goes explicit); the explicit list must be maintained as the relation graph grows.

**Recommendation:** **Option A (`forFeature([Video, Channel, User])`)** — `forFeature` is precisely the discovery mechanism the project rule prescribes, and enumerating the three entities the `Video` relation graph spans is a one-line, low-risk fix that keeps the worker's discovery identical to the API's. The worker only writes `Video`; naming `Channel`/`User` for relation metadata is acceptable and their unused repositories are inert. Option B drags entire domain graphs in for metadata; Option C forks the discovery convention. If stricter ownership is later preferred, Option C is the natural fallback (explicit metadata, no foreign repositories) without the import-weight of Option B.

**Decision:** A

---

## TD-03: `node_modules` Isolation Between Image and Bind Mount

**Scope:** Repo-wide

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Serviço de processamento em segundo plano (filas)"

**Context:** Both runtime containers mount the host working directory at `/home/node/app` (`- .:/home/node/app`) for hot reload. A bind mount overlays the container filesystem at that path, so it also shadows any `node_modules` baked into the image with the host's `node_modules` — which on a fresh clone is absent, and on a mismatched host is built for the wrong OS/architecture. The consequence is that `nest`, `@aws-sdk/client-s3`, `bullmq`, the TypeORM CLI (migrations), and both `start:dev`/`start:worker` only work when the host happened to run `npm install` on a matching platform. The storage service and the queue/worker service cannot boot under Compose unless their containers resolve a correct `node_modules`. The stack must come up from a clean clone regardless of the host.

**Options:**

### Option A: Image-built deps + anonymous `node_modules` volume
- In both Dockerfiles, `COPY --chown=node:node package.json package-lock.json` then `RUN npm ci` as the `node` user. In `compose.yaml`, add an anonymous volume `- /home/node/app/node_modules` to `nestjs-api` and `nestjs-worker` so the source bind mount does not shadow the image's `node_modules`.
- **Pros:** The container owns a platform-correct `node_modules` built from the lockfile; host install state is irrelevant; the source bind mount (and hot reload) is preserved — only the `node_modules` subpath is carved out; this is the standard Docker-for-Node dev idiom; `npm ci` is reproducible.
- **Cons:** Requires `docker compose up -d --build` after dependency changes; the anonymous volume persists across recreation and can hold stale deps if you forget `--build`/`--renew-anon-volumes`; the Compose volume path must match the Dockerfile `WORKDIR` (cross-file consistency to maintain).

### Option B: Named `node_modules` volume, no image deps
- Mount a named volume at `/home/node/app/node_modules` and populate it on first run.
- **Pros:** Deps survive container recreation; the volume is shared and reusable across runs.
- **Cons:** A clean `up` is still not operational — first run needs an explicit populate/install step; the named volume goes stale silently on dependency changes and must be recreated by hand; bootstrapping order is implicit rather than declared.

### Option C: Status quo — `docker compose exec … npm install` as a manual first step
- Keep no image deps and no `node_modules` volume; rely on a documented post-`up` install.
- **Pros:** No Dockerfile/Compose change; smallest diff.
- **Cons:** A clean `docker compose up -d` is **not** operational — it fails until a manual install on the correct architecture, which is exactly the failure being addressed; the worker has no documented install step at all; reproducibility depends on host state.

**Recommendation:** **Option A (image-built deps + anonymous volume)** — baking `npm ci` into each image and carving `node_modules` out of the source bind mount with an anonymous volume is the standard pattern that makes `docker compose up -d --build` operational from a clean clone on any architecture, while keeping the bind mount (hot reload) intact. Option B still needs a populate step and drifts silently; Option C is the current failure mode. The one explicit cost — rebuild on dependency changes — is acceptable and well understood. Note this applies only after a `--build`.

**Decision:** A

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Repo-wide | MinIO Bucket Provisioning at Compose Startup | Dedicated ephemeral `minio-init` service | A |
| TD-02 | Backend | Worker Entity-Graph Registration | `forFeature([Video, Channel, User])` | A |
| TD-03 | Repo-wide | `node_modules` Isolation Between Image and Bind Mount | Image-built deps + anonymous volume | A |
