# task-startup-infra — Progress

**Status:** completed
**Stages:** 4/4 completed

### Stage 1 — Completar `.env.example` com blocos S3 e Redis
- **Status:** completed
- **Tests:** no tests (config file, validated by inspection of env.validation.ts)
- **Observations:** none

### Stage 2 — Provisionar bucket MinIO via container de init one-shot
- **Status:** completed
- **Tests:** no tests (infra Compose change; validated by `docker compose config` — exit 0)
- **Observations:** none

### Stage 3 — Isolar `node_modules` entre imagem e bind mount
- **Status:** completed
- **Tests:** no tests (Dockerfile/Compose change; validated by `docker compose config` — exit 0)
- **Observations:** none

### Stage 4 — Registrar grafo de entidades do Video no worker
- **Status:** completed
- **Tests:** 1 passing (WorkerModule compilation unit test — entity relation graph resolves without errors)
- **Observations:**
  - `minio/mc` image was unavailable on Docker Hub; switched `minio-init` to `elestio/minio` (already used by the minio service, bundles `mc`).
  - `Dockerfile.dev` and `Dockerfile.worker` required `RUN chown node:node /home/node/app` before `USER node` — Docker creates `WORKDIR` as root, preventing `npm ci` from writing `node_modules`.
