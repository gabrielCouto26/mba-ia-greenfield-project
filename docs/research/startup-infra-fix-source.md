# Documento-fonte — Fix de Startup / Infra (stack Docker da Fase 03)

> **Propósito deste documento.** Capturar, com precisão, a solução já validada manualmente na branch
> descartável `fix/start-up`, para ser usada como **entrada (source material) do workflow do desafio**
> (research → plan-context → plan-validate → plan-resolve → plan-build → implement) numa branch nova a
> partir de `main`. A solução abaixo **não deve ser copiada direto**: ela alimenta a etapa de research;
> o plano reconstrói e justifica cada mudança e fecha com a Definition of Done.
>
> - Data: 2026-10-26 · Autor: Claude Code
> - Branch de referência (não mergear): `fix/start-up` (5 commits à frente de `main`/`dev`)
> - Baseline: `main` == `dev` == `fdf0535` (não contém nenhuma destas mudanças)
> - Enquadramento sugerido: **decisões de infraestrutura da Fase 03** (worker, storage, Compose) —
>   acrescentar como TDs em `docs/decisions/technical-decisions-phase-03-videos.md` e registrar em
>   `docs/phases/phase-03-videos/progress.md`, em vez de criar uma "fase nova".

---

## 1. Problema observado

Ao subir a stack com `docker compose up -d` a partir de um clone limpo, o ambiente não ficava
operacional:

1. **Bucket S3 inexistente** — nada criava o bucket no MinIO; qualquer operação de storage falhava.
2. **Worker não inicializava o DataSource** — o `WorkerModule` quebrava ao resolver as relações da
   entidade `Video` (ManyToOne com `Channel`, e `Channel`→`User`) porque essas entidades não estavam
   registradas no contexto do worker.
3. **Dependência de `node_modules` do host** — o bind mount `.:/home/node/app` sombreava o
   `node_modules`, então a stack só funcionava se o host tivesse feito `npm install` na arquitetura
   certa; em host novo / arquitetura diferente, `start:dev`, `migration:run` e o worker quebravam.
4. **Variáveis S3/Redis ausentes do `.env.example`** — quem clonava não sabia quais variáveis definir.

> Comportamento **esperado por design** (não é bug, não entra neste fix): a stack sobe só a
> infraestrutura; `nestjs-api`/`nestjs-worker` ficam ociosos (`tail -f /dev/null`) e o servidor/worker
> e as migrations são passos manuais (`npm run start:dev`, `npm run start:worker`, `npm run
> migration:run`). Ver `nestjs-project/CLAUDE.md`.

---

## 2. Causas-raiz e solução (por mudança)

### 2.1 Provisionamento do bucket — serviço `minio-init` no Compose
**Causa:** o MinIO sobe vazio; nenhuma etapa cria o bucket `streamtube`.
**Solução:** novo serviço efêmero `minio-init` (imagem `elestio/minio`, que traz o `mc`) que cria o
bucket e sai; `nestjs-api` e `nestjs-worker` passam a depender dele com
`condition: service_completed_successfully`.

### 2.2 Worker não resolve relações da `Video` — `forFeature([Video, Channel, User])`
**Causa:** o `WorkerModule` usa `autoLoadEntities: true`. Conforme
`.claude/rules/nestjs-modules.md`, mesmo com `autoLoadEntities`, uma entidade só é descoberta se
**algum módulo a registra via `forFeature`**. O worker registrava só `Video`; as relações `Channel` e
`User` ficavam ausentes do DataSource, quebrando a inicialização.
**Solução:** registrar as três entidades: `TypeOrmModule.forFeature([Video, Channel, User])`.
**Ponto de atenção para o plano:** avaliar se isso respeita o Single Responsibility (o worker precisa
das entidades só para resolver relações de leitura). É aceitável para um contexto de worker, mas o
plano deve justificar — é uma decisão, não um acidente.

### 2.3 `node_modules` embutido na imagem + volume anônimo
**Causa:** o bind mount do código-fonte sombreava o `node_modules` da imagem pelo do host.
**Solução:** nos dois Dockerfiles, após o `WORKDIR`: `chown node:node`, `COPY package.json
package-lock.json`, e `RUN npm ci` como usuário `node` — construindo o `node_modules` para a
plataforma do container. No `compose.yaml`, um **volume anônimo** `- /home/node/app/node_modules` em
`nestjs-api` e `nestjs-worker` impede que o bind mount sobreponha o `node_modules` da imagem.
**Ação necessária:** vale só após `docker compose up -d --build`.

### 2.4 Documentar S3/Redis no `.env.example`
**Causa:** variáveis S3/Redis não documentadas.
**Solução:** acrescentar os blocos S3 e Redis ao `.env.example` (hosts por nome de serviço do
Compose — `minio`, `redis` — nunca `localhost`).

---

## 3. Diff exato da solução (`main..fix/start-up`, 5 arquivos)

> Referência literal para a etapa de implementação. Reconstruir via plano, não colar cru.

### `nestjs-project/compose.yaml`
```diff
@@ services: nestjs-api:
     volumes:
       - .:/home/node/app
+      - /home/node/app/node_modules
     depends_on:
       db:
         condition: service_healthy
@@ (depends_on do nestjs-api)
       minio:
         condition: service_healthy
+      minio-init:
+        condition: service_completed_successfully
@@ (novo serviço, após o bloco do minio)
+  minio-init:
+    image: elestio/minio
+    depends_on:
+      minio:
+        condition: service_healthy
+    env_file: .env
+    entrypoint:
+      - /bin/sh
+      - -c
+      - "mc alias set local http://minio:9000 $$S3_ACCESS_KEY_ID $$S3_SECRET_ACCESS_KEY && mc mb --ignore-existing local/$$S3_BUCKET"
+
   nestjs-worker:
@@ (volumes do nestjs-worker)
     volumes:
       - .:/home/node/app
+      # Anonymous volume: keep the image's node_modules instead of letting the
+      # bind mount above shadow it with a (possibly missing / wrong-arch) host copy.
+      - /home/node/app/node_modules
@@ (depends_on do nestjs-worker)
       minio:
         condition: service_healthy
+      minio-init:
+        condition: service_completed_successfully
```

### `nestjs-project/Dockerfile.dev`
```diff
 WORKDIR /home/node/app
+RUN chown node:node /home/node/app
+
+COPY --chown=node:node package.json package-lock.json ./
 
 USER node
 
+RUN npm ci
+
 CMD [ "tail", "-f", "/dev/null" ]
```

### `nestjs-project/Dockerfile.worker`
```diff
 WORKDIR /home/node/app
+RUN chown node:node /home/node/app
+
+COPY --chown=node:node package.json package-lock.json ./
 
 USER node
 
+RUN npm ci
+
 CMD ["tail", "-f", "/dev/null"]
```

### `nestjs-project/.env.example`
```diff
 MAIL_FROM="StreamTube" <noreply@streamtube.com>
+
+# S3 / MinIO
+S3_ENDPOINT=http://minio:9000
+S3_REGION=us-east-1
+S3_BUCKET=streamtube
+S3_ACCESS_KEY_ID=streamtube
+S3_SECRET_ACCESS_KEY=streamtube123
+
+# Redis
+REDIS_HOST=redis
+REDIS_PORT=6379
```

### `nestjs-project/src/worker.module.ts`
```diff
 import { Video } from './videos/entities/video.entity';
+import { Channel } from './channels/entities/channel.entity';
+import { User } from './users/entities/user.entity';
@@
-    TypeOrmModule.forFeature([Video]),
+    TypeOrmModule.forFeature([Video, Channel, User]),
```

---

## 4. Vínculo com os critérios de aceite

- `desafio/criterios-de-aceite.md:21` — *"Object storage, fila e worker subindo via docker compose
  junto com o backend"*: o `minio-init` garante o bucket num `up` limpo; o fix do worker garante que
  o `nestjs-worker` inicializa.
- `desafio/criterios-de-aceite.md:24` — Definition of Done: o plano deve fechar com
  `npx tsc --noEmit` = 0, `npm run lint`, e a suíte (unit + integração + e2e afetados + suíte completa).
- `desafio/regras.md` / `CLAUDE.md` — Docker: hosts sempre por nome de serviço (`minio`, `redis`, `db`),
  nunca `localhost`.

---

## 5. Como rodar pelo workflow do desafio (checklist)

1. **Branch limpa** a partir de `main` (ex.: `bugfix/startup-stack`). Não mergear `fix/start-up`.
2. **research** → registrar as 4 decisões (§2) como TDs em
   `docs/decisions/technical-decisions-phase-03-videos.md`, com trade-offs (ex.: `minio-init`
   dedicado vs entrypoint no `nestjs-api`; entidades no worker vs módulo dedicado).
3. **plan-context / plan-validate / plan-resolve** → `validation.md` em `clean`; `library-refs.md` se
   fixar lib nova (não é esperado — tudo já existe).
4. **plan-build** → SIs pequenos (ex.: SI-A `minio-init` + depends_on; SI-B `forFeature` do worker;
   SI-C `node_modules` na imagem + volume anônimo; SI-D `.env.example`), cada um com Technical Spec.
5. **implement** → re-aplicar o diff da §3 por SI; validar cada um; `progress.md` atualizado.
6. **DoD** → `docker compose up -d --build` limpo (bucket criado, worker inicializa), suíte verde,
   tsc 0, lint OK.

---

## 6. Verificações de runtime já feitas (evidência)

Na `fix/start-up`, com a solução aplicada, verificado em 2026-10-25/26:
- `docker compose ps` → todos os serviços Up; `minio-init` Exited(0).
- `node_modules` do container é mount distinto (volume anônimo); `node_modules/.bin/nest` presente.
- `start:dev` sobe e `curl http://localhost:3000` → `200 Hello World!`.
- `start:worker` roda; upload multipart completo processou um `.webm` de ~1,2 GB até `status=ready`
  (duração + thumbnail gerados).
- Migrations aplicadas (6 tabelas, 3 migrations) — passo manual, fora deste fix.
