---
kind: task
name: task-startup-infra
test_specs_aware: true
sources_mtime:
  docs/tasks/task-startup-infra/context.md: "2026-10-26T00:42:30-03:00"
  docs/decisions/technical-decisions-startup-infra.md: "2026-10-26T00:29:35-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-17T23:10:16-03:00"
---

# task-startup-infra

## Objective

Docker startup/infra reliability for the Phase 03 video stack: deterministic MinIO bucket provisioning, worker entity-graph registration, and node_modules isolation so a clean `docker compose up` is operational on any host.

---

## Step Implementations

### SI-1 — Completar `.env.example` com blocos S3 e Redis

**Description:** Uma clonagem limpa que copia `.env.example` para `.env` precisa resolver todas as chaves exigidas pelo schema Joi; `S3_*` e `REDIS_*` já são validadas em `env.validation.ts` mas estão ausentes do exemplo.

**Technical actions:**

1. Adicionar bloco S3 a `.env.example` — `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, com host pelo nome de serviço Compose `minio` (per `startup-infra/TD-01`).
2. Adicionar bloco Redis a `.env.example` — `REDIS_HOST=redis`, `REDIS_PORT=6379`, host pelo nome de serviço `redis` (per `startup-infra/TD-01`).

**Tests:** _(empty — arquivo de configuração; sem camada de teste NestJS, verificado pela Definition of Done)_

**Dependencies:** none

**Acceptance criteria:**

- Copiar `.env.example` para `.env` resolve todas as chaves `required` do schema Joi (`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`), permitindo que API e worker subam sem erro de validação de ambiente.
- Todos os hosts dos blocos S3/Redis usam nomes de serviço Compose (`minio`, `redis`), nunca `localhost`.

---

### SI-2 — Provisionar bucket MinIO via container de init one-shot

**Description:** Adicionar um serviço `minio-init` one-shot que cria o bucket `$S3_BUCKET` de forma idempotente, com API e worker liberados somente após sua conclusão bem-sucedida.

**Technical actions:**

1. Adicionar serviço `minio-init` a `nestjs-project/compose.yaml` — imagem `minio/mc`, `depends_on: minio (condition: service_healthy)`, entrypoint que roda `mc alias set` e então `mc mb --ignore-existing <alias>/$S3_BUCKET` (per `startup-infra/TD-01`).
2. Fornecer credenciais e bucket ao `minio-init` por ambiente (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `S3_BUCKET`) para que o nome do bucket derive da config e não de um literal.
3. Ligar `nestjs-api` a `minio-init` via `depends_on` com `condition: service_completed_successfully`.
4. Ligar `nestjs-worker` a `minio-init` via `depends_on` com `condition: service_completed_successfully`.

**Tests:** _(empty — infra Compose; verificado pela Definition of Done: `docker compose up -d --build` limpo cria o bucket)_

**Dependencies:** SI-1 — `minio-init` deriva o nome do bucket de `$S3_BUCKET`, chave que o SI-1 adiciona ao ambiente.

**Acceptance criteria:**

- Após `docker compose up -d --build`, o bucket `$S3_BUCKET` existe no MinIO sem nenhum passo manual.
- Reexecutar `docker compose up` não falha quando o bucket já existe (`mc mb --ignore-existing` idempotente).
- `nestjs-api` e `nestjs-worker` iniciam apenas após o `minio-init` concluir com sucesso.

---

### SI-3 — Isolar `node_modules` entre imagem e bind mount

**Description:** Assar `npm ci` em cada imagem e separar `node_modules` do bind mount de código com um volume anônimo, tornando `docker compose up -d --build` operacional a partir de um clone limpo em qualquer arquitetura.

**Technical actions:**

1. Em `Dockerfile.dev`: `COPY --chown=node:node package.json package-lock.json ./` seguido de `RUN npm ci`, antes do `CMD` de dev (per `startup-infra/TD-03`).
2. Em `Dockerfile.worker`: `COPY --chown=node:node package.json package-lock.json ./` seguido de `RUN npm ci`, antes do `CMD` do worker (per `startup-infra/TD-03`).
3. Adicionar volume anônimo `- /home/node/app/node_modules` ao serviço `nestjs-api` em `compose.yaml`, para o bind mount de código não sombrear o `node_modules` da imagem.
4. Adicionar volume anônimo `- /home/node/app/node_modules` ao serviço `nestjs-worker` em `compose.yaml`.

**Tests:** _(empty — imagem Docker / infra Compose; verificado pela Definition of Done)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d --build` a partir de um clone limpo deixa `node_modules` populado dentro de `nestjs-api` e `nestjs-worker` sem passo manual de `npm install`.
- O bind mount de código não sombreia mais o `node_modules` da imagem (o volume anônimo prevalece sobre o bind mount do código-fonte).

---

### SI-4 — Registrar grafo de entidades do Video no worker

**Description:** Expandir o `forFeature` do `WorkerModule` para que o grafo de relações do `Video` (`Channel`, `User`) resolva no DataSource do worker.

**Technical actions:**

1. Importar `Channel` (`./channels/entities/channel.entity`) e `User` (`./users/entities/user.entity`) em `src/worker.module.ts`.
2. Alterar `TypeOrmModule.forFeature([Video])` para `TypeOrmModule.forFeature([Video, Channel, User])` (per `startup-infra/TD-02`) — registra o metadata de relação que o grafo do `Video` percorre; o worker continua escrevendo apenas `Video`.
3. Adicionar `src/worker.module.spec.ts` — teste unitário de compilação que compila o `WorkerModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` | Unit: compilação — `Test.createTestingModule({ imports: [WorkerModule] }).compile()` resolve sem erro de metadata de entidade (captura o erro de wiring que o TD-02 corrige) | `src/worker.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Compilar o `WorkerModule` em teste resolve o metadata das relações `Video → Channel → User` sem erro de entidade/relação ausente.
- O processo worker inicializa (seu DataSource resolve o grafo de relações do `Video`) ao subir contra a stack Compose.

---

## Dependency Map

```
SI-1 (root) — .env.example S3/Redis blocks
└── SI-2 — depends on SI-1 (minio-init deriva o bucket de $S3_BUCKET, chave adicionada ao ambiente pelo SI-1)
SI-3 (root, independent) — node_modules isolation (Dockerfiles + anonymous volumes)
SI-4 (root, independent) — WorkerModule forFeature entity-graph registration
```

---

## Deliverables

- [ ] SI-1 — Completar `.env.example` com blocos S3 e Redis
- [ ] SI-2 — Provisionar bucket MinIO via container de init one-shot
- [ ] SI-3 — Isolar `node_modules` entre imagem e bind mount
- [ ] SI-4 — Registrar grafo de entidades do Video no worker

**Definition of Done:**

- [ ] Clean `docker compose up -d --build` from a fresh clone is operational: the `$S3_BUCKET` bucket is provisioned and the worker initializes (resolves the Video relation graph) — the defining deliverable of this task.
- [ ] Backend unit tests pass (`cd nestjs-project && npm test`)
- [ ] Backend integration tests pass (`cd nestjs-project && npm run test:integration`)
- [ ] Backend E2E tests pass (`cd nestjs-project && npm run test:e2e`)
- [ ] Type/compilation check passes (`cd nestjs-project && npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && npm run lint`)
