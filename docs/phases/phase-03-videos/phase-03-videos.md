---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-16 18:32:19.979261272 -0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-16 18:16:26.754943772 -0300"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-15 21:21:34.577088725 -0300"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Implementar a infraestrutura de backend para upload de vídeos de até 10GB via S3 multipart, processamento automático em segundo plano (extração de metadados e geração de thumbnail via FFmpeg), streaming e download via presigned URLs, com pré-cadastro automático como rascunho, URLs únicas por vídeo (nanoid), e lifecycle de status com tratamento de erros.

---

## Step Implementations

### SI-03.1 — Infraestrutura: Docker Compose (Redis, MinIO) + config modules

**Description:** Adicionar serviços Redis e MinIO ao Docker Compose e criar módulos de configuração NestJS para S3 e Redis, preparando a infraestrutura base para upload e processamento de vídeos.

**Technical actions:**

1. Adicionar serviço `redis` (Redis 7 Alpine) ao `docker-compose.yml` — porta 6379, healthcheck via `redis-cli ping` (per `phase-03-videos/TD-01`)
2. Adicionar serviço `minio` (MinIO) ao `docker-compose.yml` — portas 9000 (API) + 9001 (console), volume persistente, bucket padrão via entrypoint script (per `phase-03-videos/TD-02`)
3. Criar `src/config/s3.config.ts` — configuração namespaced via `registerAs('s3', () => ({...}))` para endpoint, region, bucket, access key, secret key (per `phase-03-videos/TD-02`, convenção herdada `phase-01-configuracao-base/TD-03`)
4. Criar `src/config/redis.config.ts` — configuração namespaced via `registerAs('redis', () => ({...}))` para host e porta (per `phase-03-videos/TD-01`, convenção herdada `phase-01-configuracao-base/TD-03`)
5. Atualizar `src/config/env.validation.ts` — adicionar variáveis S3 e Redis ao schema Joi (per convenção herdada `phase-01-configuracao-base/TD-02`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `s3.config.ts` | Unit: compilation + factory output | `src/config/s3.config.spec.ts` |
| `redis.config.ts` | Unit: compilation + factory output | `src/config/redis.config.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` levanta redis, minio e db sem erros
- `docker compose exec nestjs-api redis-cli -h redis ping` retorna `PONG`
- MinIO console acessível em http://localhost:9001
- `env.validation.ts` rejeita inicialização com variáveis S3 ou Redis faltando

---

### SI-03.2 — Entidade Video + migração + módulo

**Description:** Criar a entidade Video com todos os campos do Data Model, migração correspondente e o módulo VideosModule como esqueleto para os serviços da fase.

**Technical actions:**

1. Instalar dependência `nanoid` (per `phase-03-videos/TD-05`)
2. Criar `src/videos/entities/video.entity.ts` — campos: id (uuid PK), public_id (varchar(11) unique, nanoid), title (varchar(255) default ''), status (enum draft/processing/ready/error, default draft), error_reason (text nullable), duration (float nullable), size_bytes (bigint nullable), mimetype (varchar(100) nullable), original_filename (varchar(255) nullable), storage_key (varchar(512) not null), thumbnail_key (varchar(512) nullable), upload_id (varchar(255) nullable), channel_id (uuid FK → Channel), created_at, updated_at (per Data Model, `phase-03-videos/TD-05`, `phase-03-videos/TD-07`)
3. Criar migração TypeORM para tabela `video` — índices: unique em public_id, index em channel_id, index em status
4. Criar `src/videos/videos.module.ts` — imports: TypeOrmModule.forFeature([Video]), ConfigModule
5. Registrar `VideosModule` em `AppModule.imports`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` entity | Integration: constraints (unique public_id, not null, FK), defaults (status draft, timestamps) | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideosModule` | Unit: module compilation | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.1 — config modules devem existir para importação no módulo

**Acceptance criteria:**

- Migração roda sem erros e cria tabela `video` com todas as colunas e índices
- Inserir registro com public_id duplicado retorna violação de constraint unique
- Inserir registro sem channel_id retorna violação de FK
- Campo status tem default `draft` quando não especificado

---

### SI-03.3 — Upload iniciar (POST /videos)

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/upload-initiate.plan.md`

**Description:** Implementar o endpoint de inicialização de upload que cria o vídeo como rascunho, inicia o S3 multipart upload via `CreateMultipartUploadCommand` e retorna os metadados do vídeo criado.

**Technical actions:**

1. Criar `src/videos/services/storage.service.ts` — client S3 (`@aws-sdk/client-s3`) com método `initiateMultipartUpload(key)` que executa `CreateMultipartUploadCommand` e retorna `uploadId` (per `phase-03-videos/TD-02`)
2. Criar `src/videos/dto/create-video.dto.ts` — validação: filename (string, max 255), mimetype (string, pattern video/*), size (number, max 10737418240), channel_id (uuid) (per API Contracts Validation Rules)
3. Criar `src/videos/services/videos.service.ts` — método `create(dto, userId)`: gerar public_id via `nanoid(11)`, construir storage_key, chamar `StorageService.initiateMultipartUpload`, salvar entidade Video com status `draft` e upload_id (per `phase-03-videos/TD-02`, `phase-03-videos/TD-05`, `phase-03-videos/TD-07`)
4. Criar `src/videos/controllers/videos.controller.ts` — `POST /videos` com `@UseGuards(JwtAuthGuard)`, validar ownership do channel via channel_id + userId, retornar 201 com id, public_id, status (per API Contracts, Authorization Matrix)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: real MinIO — initiateMultipartUpload retorna uploadId válido | `src/videos/services/storage.service.integration-spec.ts` |
| `VideosService` | Unit: create — mock repo + mock StorageService, verifica nanoid, status draft, upload_id persistido | `src/videos/services/videos.service.spec.ts` |

**Dependencies:** SI-03.2 — entidade Video e módulo devem existir

**Acceptance criteria:**

- `POST /videos` com payload válido e token de owner retorna 201 com public_id de 11 caracteres e status `draft`
- `POST /videos` sem Authorization header retorna 401
- `POST /videos` com channel_id de outro usuário retorna 403 NOT_CHANNEL_OWNER
- `POST /videos` com size > 10737418240 retorna 400 validation error

---

### SI-03.4 — Upload gerenciamento: presign-part + abort

**Route:** POST /videos/:publicId/upload/presign-part, POST /videos/:publicId/upload/abort
**Test Specs:** see `nestjs-project/specs/upload-management.plan.md`

**Description:** Implementar os endpoints de gerenciamento do upload multipart: geração de presigned URL para upload de partes e abortar upload em andamento.

**Technical actions:**

1. Adicionar métodos `getPresignedPartUrl(key, uploadId, partNumber)` e `abortMultipartUpload(key, uploadId)` ao `StorageService` — presigned `UploadPartCommand` e `AbortMultipartUploadCommand` (per `phase-03-videos/TD-02`)
2. Criar `src/videos/dto/presign-part.dto.ts` — validação: part_number (number, min 1, max 10000) (per API Contracts Validation Rules)
3. Implementar `VideosService.presignPart(publicId, partNumber, userId)` — validar ownership, verificar status `draft` + upload_id presente, chamar `StorageService.getPresignedPartUrl` (per `phase-03-videos/TD-02`)
4. Implementar `VideosService.abortUpload(publicId, userId)` — validar ownership, chamar `StorageService.abortMultipartUpload`, limpar upload_id no registro (per `phase-03-videos/TD-02`)
5. Adicionar endpoints `POST /videos/:publicId/upload/presign-part` e `POST /videos/:publicId/upload/abort` ao `VideosController` com `@UseGuards(JwtAuthGuard)` (per API Contracts, Authorization Matrix)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: presignPart — ownership check, state validation (draft + upload_id), delegation ao StorageService | `src/videos/services/videos.service.spec.ts` (extend) |
| `VideosService` | Unit: abortUpload — ownership check, S3 abort, upload_id cleanup | `src/videos/services/videos.service.spec.ts` (extend) |
| `StorageService` | Integration: getPresignedPartUrl retorna URL assinada; abortMultipartUpload executa sem erro | `src/videos/services/storage.service.integration-spec.ts` (extend) |

**Dependencies:** SI-03.3 — StorageService + VideosService + VideosController devem existir

**Acceptance criteria:**

- `POST /videos/:publicId/upload/presign-part` com part_number válido retorna 200 com presigned_url
- `POST /videos/:publicId/upload/presign-part` para vídeo com status ≠ `draft` retorna 409 UPLOAD_NOT_IN_PROGRESS
- `POST /videos/:publicId/upload/abort` retorna 204 e limpa upload_id no registro
- Ambos endpoints retornam 403 NOT_CHANNEL_OWNER para usuário não-dono
- Ambos endpoints retornam 404 VIDEO_NOT_FOUND para publicId inexistente

---

### SI-03.5 — Infraestrutura BullMQ

**Description:** Configurar integração `@nestjs/bullmq` com Redis no NestJS e registrar a fila de processamento de vídeos, preparando a infraestrutura de jobs para o worker.

**Technical actions:**

1. Instalar dependências `@nestjs/bullmq` e `bullmq` (per `phase-03-videos/TD-01`)
2. Registrar `BullModule.forRoot()` em `AppModule` com configuração de conexão Redis via `redis.config` (per `phase-03-videos/TD-01`, convenção herdada `phase-01-configuracao-base/TD-03`)
3. Registrar `BullModule.registerQueue({ name: 'video-processing' })` em `VideosModule` (per `phase-03-videos/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosModule` | Unit: module compilation com BullMQ registrado | `src/videos/videos.module.spec.ts` (extend) |

**Dependencies:** SI-03.1 — `redis.config.ts` deve existir

**Acceptance criteria:**

- NestJS inicializa sem erros com `BullModule` configurado
- Fila `video-processing` é registrada e acessível via injeção de dependência

---

### SI-03.6 — Upload complete (POST /videos/:publicId/upload/complete)

**Route:** POST /videos/:publicId/upload/complete
**Test Specs:** see `nestjs-project/specs/upload-complete.plan.md`

**Description:** Implementar o endpoint de conclusão do upload multipart que finaliza o upload no S3, transiciona o status do vídeo para `processing` e enfileira o job de processamento via BullMQ.

**Technical actions:**

1. Adicionar método `completeMultipartUpload(key, uploadId, parts)` ao `StorageService` — executa `CompleteMultipartUploadCommand` (per `phase-03-videos/TD-02`)
2. Criar `src/videos/dto/complete-upload.dto.ts` — validação: parts (array non-empty, cada item: part_number number + etag string) (per API Contracts Validation Rules)
3. Implementar `VideosService.completeUpload(publicId, parts, userId)` — validar ownership + estado `draft`, chamar `StorageService.completeMultipartUpload`, transicionar status para `processing`, limpar upload_id, enfileirar job `video.process` com payload `{ videoId, storageKey }` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-07`)
4. Adicionar endpoint `POST /videos/:publicId/upload/complete` ao `VideosController` com `@UseGuards(JwtAuthGuard)` (per API Contracts, Authorization Matrix)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: completeUpload — S3 complete, status transition draft→processing, job enqueue (mock storage + mock queue) | `src/videos/services/videos.service.spec.ts` (extend) |
| `StorageService` | Integration: completeMultipartUpload finaliza upload real no MinIO | `src/videos/services/storage.service.integration-spec.ts` (extend) |

**Dependencies:** SI-03.3 — StorageService + VideosService + controller; SI-03.5 — BullMQ fila registrada

**Acceptance criteria:**

- `POST /videos/:publicId/upload/complete` com parts válidas retorna 200 com status `processing`
- Status do vídeo no banco transiciona de `draft` para `processing`
- Job `video.process` é enfileirado no BullMQ com videoId e storageKey corretos
- `POST /complete` para vídeo com status ≠ `draft` retorna 409 UPLOAD_NOT_IN_PROGRESS
- `POST /complete` por não-dono retorna 403 NOT_CHANNEL_OWNER

---

### SI-03.7 — Video processing worker (FFmpeg + BullMQ consumer)

**Description:** Implementar o worker de processamento de vídeos em container separado: consumer BullMQ que extrai metadados via ffprobe, gera thumbnail via ffmpeg e atualiza o status do vídeo.

**Technical actions:**

1. Criar `src/videos/services/ffmpeg.service.ts` — wrapper async sobre `child_process.execFile`: método `extractMetadata(filePath)` retorna duration via ffprobe, método `generateThumbnail(inputPath, outputPath, timestamp)` captura frame via ffmpeg (per `phase-03-videos/TD-06`)
2. Criar `src/videos/processors/video.processor.ts` — `@Processor('video-processing')` com handler para job `video.process` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`)
3. Implementar `VideoProcessor.process(job)` — download temporário do S3, chamar `FfmpegService.extractMetadata` + `generateThumbnail`, upload thumbnail ao S3, atualizar Video entity (duration, thumbnail_key, status→`ready`); em caso de erro, setar status→`error` + error_reason (per `phase-03-videos/TD-06`, `phase-03-videos/TD-07`)
4. Criar `src/worker.main.ts` — entry point dedicado via `NestFactory.createApplicationContext(WorkerModule)` (per `phase-03-videos/TD-04`)
5. Adicionar serviço `worker` ao `docker-compose.yml` — mesmo codebase, command aponta para `worker.main.ts`, FFmpeg instalado no container, depends_on: redis, minio, db (per `phase-03-videos/TD-04`, `phase-03-videos/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfmpegService` | Unit: mock `child_process.execFile` — extractMetadata retorna duration, generateThumbnail resolve | `src/videos/services/ffmpeg.service.spec.ts` |
| `VideoProcessor` | Unit: process sucesso — mock FFmpeg + mock repo + mock Storage → status `ready` + thumbnail_key | `src/videos/processors/video.processor.spec.ts` |
| `VideoProcessor` | Unit: process erro — FFmpeg falha → status `error` + error_reason preenchido | `src/videos/processors/video.processor.spec.ts` |

**Dependencies:** SI-03.5 — BullMQ fila registrada; SI-03.2 — entidade Video

**Acceptance criteria:**

- Worker inicia via `docker compose up worker` sem erros
- Job `video.process` com storageKey de vídeo real: status final = `ready`, duration preenchido, thumbnail_key preenchido
- Job com storageKey inválido: status final = `error`, error_reason preenchido com mensagem descritiva
- Worker processa job com retry automático e exponential backoff (per `phase-03-videos/TD-01`)
- Container worker roda em processo separado do nestjs-api (per `phase-03-videos/TD-04`)

---

### SI-03.8 — Streaming + download

**Route:** GET /videos/:publicId/stream, GET /videos/:publicId/download
**Test Specs:** see `nestjs-project/specs/video-streaming.plan.md`

**Description:** Implementar os endpoints de streaming e download de vídeo via redirect para presigned URLs do S3, com suporte nativo a range requests pelo MinIO.

**Technical actions:**

1. Adicionar método `getPresignedGetUrl(key, options?)` ao `StorageService` — gera presigned URL via `getSignedUrl` + `GetObjectCommand`, suporte a `response-content-disposition` para download (per `phase-03-videos/TD-03`)
2. Implementar `VideosService.getStreamUrl(publicId)` — validar status = `ready`, gerar presigned GET URL (per `phase-03-videos/TD-03`, `phase-03-videos/TD-07`)
3. Implementar `VideosService.getDownloadUrl(publicId)` — validar status = `ready`, gerar presigned GET URL com Content-Disposition: attachment (per `phase-03-videos/TD-03`)
4. Adicionar endpoint `GET /videos/:publicId/stream` ao `VideosController` — retorna 302 redirect com Location header (per API Contracts)
5. Adicionar endpoint `GET /videos/:publicId/download` ao `VideosController` — retorna 302 redirect com Content-Disposition attachment (per API Contracts)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: getStreamUrl/getDownloadUrl — status check, presigned URL generation (mock storage + mock repo) | `src/videos/services/videos.service.spec.ts` (extend) |
| `StorageService` | Integration: getPresignedGetUrl retorna URL funcional no MinIO | `src/videos/services/storage.service.integration-spec.ts` (extend) |

**Dependencies:** SI-03.3 — StorageService + VideosService + controller devem existir

**Acceptance criteria:**

- `GET /videos/:publicId/stream` para vídeo com status `ready` retorna 302 com Location apontando para MinIO
- `GET /videos/:publicId/download` retorna 302 com presigned URL contendo response-content-disposition attachment
- Ambos endpoints retornam 404 VIDEO_NOT_FOUND para publicId inexistente
- Ambos endpoints retornam 409 VIDEO_NOT_READY para vídeo com status ≠ `ready`

---

### SI-03.9 — Video info (GET /videos/:publicId)

**Route:** GET /videos/:publicId
**Test Specs:** see `nestjs-project/specs/video-info.plan.md`

**Description:** Implementar o endpoint de consulta de informações do vídeo, incluindo metadados e URL presigned para thumbnail.

**Technical actions:**

1. Implementar `VideosService.findByPublicId(publicId)` — buscar vídeo por public_id, gerar presigned URL para thumbnail via `StorageService.getPresignedGetUrl` se thumbnail_key existir (per `phase-03-videos/TD-03`)
2. Adicionar endpoint `GET /videos/:publicId` ao `VideosController` — retorna 200 com id, public_id, title, status, duration, thumbnail_url, created_at (per API Contracts)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: findByPublicId — found com thumbnail, found sem thumbnail, not found (mock repo + mock storage) | `src/videos/services/videos.service.spec.ts` (extend) |

**Dependencies:** SI-03.3 — VideosService + controller devem existir

**Acceptance criteria:**

- `GET /videos/:publicId` para vídeo existente retorna 200 com todos os campos do API Contract
- `GET /videos/:publicId` para vídeo com thumbnail retorna thumbnail_url como presigned URL
- `GET /videos/:publicId` para vídeo sem thumbnail retorna thumbnail_url: null
- `GET /videos/:publicId` para publicId inexistente retorna 404 VIDEO_NOT_FOUND

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| public_id | varchar(11) | unique, not null — nanoid 11 chars (`phase-03-videos/TD-05`) |
| title | varchar(255) | not null, default '' |
| status | enum('draft','processing','ready','error') | not null, default 'draft' (`phase-03-videos/TD-07`) |
| error_reason | text | nullable — populated when status = 'error' (`phase-03-videos/TD-07`) |
| duration | float | nullable — seconds, extracted by ffprobe (`phase-03-videos/TD-06`) |
| size_bytes | bigint | nullable — total file size in bytes |
| mimetype | varchar(100) | nullable |
| original_filename | varchar(255) | nullable — client-provided filename |
| storage_key | varchar(512) | not null — S3 object key for the video file (`phase-03-videos/TD-02`) |
| thumbnail_key | varchar(512) | nullable — S3 object key for generated thumbnail (`phase-03-videos/TD-06`) |
| upload_id | varchar(255) | nullable — S3 multipart upload ID, present during active upload (`phase-03-videos/TD-02`) |
| channel_id | uuid | FK → Channel, not null |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Relations:** `Video` belongs to `Channel` (many-to-one via `channel_id`); `Channel` has many `Video`.
**Indexes:** unique on `public_id`; index on `channel_id`; index on `status`.

### API Contracts

#### POST /videos (SI-03.3)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- filename: string, required — original file name
- mimetype: string, required — video MIME type (e.g., video/mp4)
- size: number, required — total file size in bytes
- channel_id: string (uuid), required — channel to upload to

**Response 201:**
- id: string (uuid)
- public_id: string (11 chars, nanoid — `phase-03-videos/TD-05`)
- status: "draft" (`phase-03-videos/TD-07`)

**Error responses:**
- 401 UNAUTHORIZED: missing or invalid access token
- 403 NOT_CHANNEL_OWNER: authenticated user does not own the specified channel
- 400 validation error: when the request body fails schema validation

---

#### POST /videos/:publicId/upload/presign-part (SI-03.4)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- part_number: number, required — 1-based part index

**Response 200:**
- presigned_url: string — presigned URL for uploading the part directly to S3/MinIO (`phase-03-videos/TD-02`)

**Error responses:**
- 401 UNAUTHORIZED: missing or invalid access token
- 404 VIDEO_NOT_FOUND: video with given publicId does not exist
- 403 NOT_CHANNEL_OWNER: authenticated user does not own the video's channel
- 409 UPLOAD_NOT_IN_PROGRESS: video status is not 'draft' or upload_id is null

---

#### POST /videos/:publicId/upload/complete (SI-03.4)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- parts: array, required — list of { part_number: number, etag: string } for each uploaded part

**Response 200:**
- id: string (uuid)
- public_id: string
- status: "processing" — transitions from 'draft' to 'processing' (`phase-03-videos/TD-07`)

**Error responses:**
- 401 UNAUTHORIZED: missing or invalid access token
- 404 VIDEO_NOT_FOUND: video with given publicId does not exist
- 403 NOT_CHANNEL_OWNER: authenticated user does not own the video's channel
- 409 UPLOAD_NOT_IN_PROGRESS: video status is not 'draft' or upload_id is null

---

#### POST /videos/:publicId/upload/abort (SI-03.4)

**Request headers:**
- Authorization: Bearer {access_token}

**Response 204:** No content.

**Error responses:**
- 401 UNAUTHORIZED: missing or invalid access token
- 404 VIDEO_NOT_FOUND: video with given publicId does not exist
- 403 NOT_CHANNEL_OWNER: authenticated user does not own the video's channel

---

#### GET /videos/:publicId/stream (SI-03.6)

**Request query parameters:** _None._

**Response 302:**
- Location header: presigned S3 GET URL for the video file (`phase-03-videos/TD-03`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: video with given publicId does not exist
- 409 VIDEO_NOT_READY: video status is not 'ready'

---

#### GET /videos/:publicId/download (SI-03.6)

**Request query parameters:** _None._

**Response 302:**
- Location header: presigned S3 GET URL with response-content-disposition: attachment (`phase-03-videos/TD-03`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: video with given publicId does not exist
- 409 VIDEO_NOT_READY: video status is not 'ready'

---

#### GET /videos/:publicId (SI-03.7)

**Request query parameters:** _None._

**Response 200:**
- id: string (uuid)
- public_id: string
- title: string
- status: string — one of 'draft', 'processing', 'ready', 'error' (`phase-03-videos/TD-07`)
- duration: number | null — seconds (`phase-03-videos/TD-06`)
- thumbnail_url: string | null — presigned S3 GET URL for thumbnail
- created_at: string (ISO 8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: video with given publicId does not exist

---

#### Validation Rules

- `filename`: required, string, max 255 chars
- `mimetype`: required, must match `video/*` pattern
- `size`: required, positive integer, max 10,737,418,240 bytes (10 GiB — per capability "até 10GB")
- `channel_id`: required, valid UUID
- `part_number`: required, positive integer, min 1, max 10,000 (S3 multipart limit)
- `parts`: required, non-empty array; each element: `part_number` (positive integer) + `etag` (non-empty string)

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✗ | ✓ |
| POST /videos/:publicId/upload/presign-part | ✗ | ✗ | ✓ |
| POST /videos/:publicId/upload/complete | ✗ | ✗ | ✓ |
| POST /videos/:publicId/upload/abort | ✗ | ✗ | ✓ |
| GET /videos/:publicId/stream | ✓ | ✓ | ✓ |
| GET /videos/:publicId/download | ✓ | ✓ | ✓ |
| GET /videos/:publicId | ✓ | ✓ | ✓ |

_Owner = authenticated user who owns the video's channel._

### Error Catalog

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | Video with given publicId does not exist |
| VIDEO_NOT_READY | 409 | Streaming/download attempted on video with status ≠ 'ready' |
| UPLOAD_NOT_IN_PROGRESS | 409 | Upload operation attempted on video without active multipart upload (status ≠ 'draft' or upload_id is null) |
| NOT_CHANNEL_OWNER | 403 | Authenticated user does not own the video's channel |

### Events/Messages

#### video.process

**Payload:**

```json
{
  "videoId": "uuid",
  "storageKey": "string"
}
```

**Producer:** `VideosService` — enqueued after `CompleteMultipartUploadCommand` succeeds (per `phase-03-videos/TD-02`)
**Consumer:** `VideoProcessorService` in worker container (per `phase-03-videos/TD-04`)
**Trigger:** POST /videos/:publicId/upload/complete succeeds — video transitions to 'processing' (`phase-03-videos/TD-07`)
**Delivery semantics:** at-least-once with retry and exponential backoff; dead-letter via `maxStalledCount` + failed job retention (per `phase-03-videos/TD-01`)

---

<!-- phase-a-complete -->

## Dependency Map

SI-03.1 (root — infra Docker + config)
├── SI-03.2 — depends on SI-03.1 (config modules para módulo)
│   └── SI-03.3 — depends on SI-03.2 (entidade Video + módulo)
│       ├── SI-03.4 — depends on SI-03.3 (StorageService + VideosService + controller)
│       ├── SI-03.8 — depends on SI-03.3 (StorageService + controller)
│       └── SI-03.9 — depends on SI-03.3 (VideosService + controller)
├── SI-03.5 — depends on SI-03.1 (redis.config.ts)
SI-03.6 — depends on SI-03.3 + SI-03.5 (upload init + BullMQ fila)
SI-03.7 — depends on SI-03.2 + SI-03.5 (entidade Video + BullMQ fila)

---

## Deliverables

- [ ] SI-03.1 — Infraestrutura: Docker Compose (Redis, MinIO) + config modules
- [ ] SI-03.2 — Entidade Video + migração + módulo
- [ ] SI-03.3 — Upload iniciar (POST /videos)
- [ ] SI-03.4 — Upload gerenciamento: presign-part + abort
- [ ] SI-03.5 — Infraestrutura BullMQ
- [ ] SI-03.6 — Upload complete (POST /videos/:publicId/upload/complete)
- [ ] SI-03.7 — Video processing worker (FFmpeg + BullMQ consumer)
- [ ] SI-03.8 — Streaming + download
- [ ] SI-03.9 — Video info (GET /videos/:publicId)

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
