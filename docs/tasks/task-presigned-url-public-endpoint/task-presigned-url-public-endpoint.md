---
kind: task
name: task-presigned-url-public-endpoint
test_specs_aware: true
sources_mtime:
  docs/tasks/task-presigned-url-public-endpoint/context.md: "2026-10-26T20:08:04-03:00"
  docs/decisions/technical-decisions-presigned-url-public-endpoint.md: "2026-10-26T20:01:55-03:00"
  docs/decisions/technical-decisions-startup-infra.md: "2026-10-26T16:36:18-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-10-15T21:21:34-03:00"
---

# Task — Public Endpoint for Presigned URLs (MinIO/S3)

## Objective

Public-reachable endpoint for presigned S3/MinIO URLs so external clients (browser, frontend, host curl) can consume upload PUT, stream/download GET, and thumbnail URLs that are currently signed with the Docker-internal host minio:9000. Backend-only change in `nestjs-project`: split S3 client (internal host for server-side ops, public endpoint for presigning), second `S3Client` for the presigner, new optional `S3_PUBLIC_ENDPOINT` env var validated via Joi with fallback to `S3_ENDPOINT`.

---

## Step Implementations

### SI-1 — Configurar endpoint público para presigning (config + env + Joi)

**Description:** Introduz `S3_PUBLIC_ENDPOINT` como origem configurável do host usado apenas na assinatura de URLs, sem alterar o host interno das operações server-side.

**Technical actions:**

1. Adicionar campo `publicEndpoint` em `src/config/s3.config.ts` — `process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || 'http://minio:9000'` (per `presigned-url-public-endpoint/TD-01`, `presigned-url-public-endpoint/TD-03`)
2. Adicionar `S3_PUBLIC_ENDPOINT: Joi.string().uri().optional()` ao schema em `src/config/env.validation.ts` (per `presigned-url-public-endpoint/TD-03`)
3. Documentar `S3_PUBLIC_ENDPOINT=http://localhost:9000` em `nestjs-project/.env.example` e definir o valor em `nestjs-project/.env` (per `presigned-url-public-endpoint/TD-03`)

**Tests:** _(empty — config factory + Joi wiring; o fallback de `publicEndpoint` e a resolução de endpoint são verificados via os testes de `StorageService` em SI-2, conforme testing-guide-nestjs-project)_

**Dependencies:** none

**Acceptance criteria:**

- Com `S3_PUBLIC_ENDPOINT` ausente, `publicEndpoint` resolve para o valor de `S3_ENDPOINT` — comportamento atual preservado (sem regressão).
- Com `S3_PUBLIC_ENDPOINT=http://localhost:9000` definido, `publicEndpoint` resolve para `http://localhost:9000`.
- Boot da aplicação com `S3_PUBLIC_ENDPOINT` não-URI falha na validação Joi no startup, impedindo subir com configuração inválida.

---

### SI-2 — Cliente presigner dedicado + reescrever presigns no StorageService

**Description:** Assina todas as presigned URLs com o endpoint público, mantendo as operações server-side no host interno do Compose — torna as URLs acessíveis por clientes fora do Docker sem violar a regra de rede ("never localhost dentro do container").

**Technical actions:**

1. Adicionar um segundo `S3Client` (`presignerClient`) no construtor de `src/videos/services/storage.service.ts`, configurado com `endpoint: config.publicEndpoint` e os mesmos `region`/`credentials`/`forcePathStyle: true` do client interno (per `presigned-url-public-endpoint/TD-02`, `presigned-url-public-endpoint/TD-01`)
2. Passar `presignerClient` em `getSignedUrl` dentro de `getPresignedPartUrl` (upload PUT) (per `presigned-url-public-endpoint/TD-01`)
3. Passar `presignerClient` em `getSignedUrl` dentro de `getPresignedGetUrl` (stream / download / thumbnail GET) (per `presigned-url-public-endpoint/TD-01`)

As demais operações — `initiateMultipartUpload`, `completeMultipartUpload`, `abortMultipartUpload`, `uploadFile`, `downloadFile` — permanecem no `client` interno, sem alteração.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Unit: `presignerClient` resolve o endpoint para `publicEndpoint`; o `client` interno resolve para o endpoint interno | `src/videos/services/storage.service.spec.ts` |
| `StorageService` | Integration (MinIO real): `getPresignedPartUrl` e `getPresignedGetUrl` retornam URL com host público e assinatura válida; create/complete/abort/upload/download operam no host interno | `src/videos/services/storage.service.integration-spec.ts` |

**Dependencies:** SI-1 — `publicEndpoint` precisa existir no config antes de instanciar o `presignerClient`

**Acceptance criteria:**

- `getPresignedPartUrl` retorna uma URL cujo host é o `publicEndpoint` configurado (ex.: `localhost:9000`), com assinatura SigV4 válida (sem `SignatureDoesNotMatch`).
- `getPresignedGetUrl` — nas três chamadas (stream, download com `response-content-disposition=attachment`, e thumbnail) — retorna URL com host público e assinatura válida.
- `initiateMultipartUpload`, `completeMultipartUpload`, `abortMultipartUpload`, `uploadFile` e `downloadFile` continuam operando contra o host interno (`minio:9000`) com sucesso.
- Uma presigned GET URL emitida é acessível a partir do host (fora do Docker) sem `curl --resolve`, retornando o objeto com `200`/`206`.

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-1 (root) — config publicEndpoint + env + Joi
└── SI-2 — depends on SI-1 (publicEndpoint precisa existir antes de instanciar o presignerClient)
```

---

## Deliverables

- [x] SI-1 — Configurar endpoint público para presigning (config + env + Joi)
- [x] SI-2 — Cliente presigner dedicado + reescrever presigns no StorageService

**Full test suites:**

- [x] Backend unit + integration tests pass (`docker compose exec nestjs-api npm test -- --runInBand`) — 33 suites, 197 tests
- [x] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`) — 8 suites, 77 tests
- [x] TypeScript compiles cleanly (`docker compose exec nestjs-api npx tsc --noEmit`) — 0 errors
- [x] Lint passes (`docker compose exec nestjs-api npm run lint`) — 0 errors
- [x] Manual: From the host (outside Docker), `GET /videos/:publicId/stream`, `/download`, and the `thumbnail_url` open without `curl --resolve`; `POST /videos/:publicId/upload/presign-part` + PUT succeed without `--resolve`
