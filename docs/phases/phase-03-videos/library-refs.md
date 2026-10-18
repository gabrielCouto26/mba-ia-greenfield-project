---
libs:
  "@aws-sdk/client-s3":
    version: "^3.1152.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-17T22:00:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1152.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-17T22:00:00-03:00"
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-17T22:00:00-03:00"
  bullmq:
    version: "^6.3.15"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-17T22:00:00-03:00"
  ioredis:
    version: "^5.11.1"
    context7_id: "/redis/ioredis"
    fetched_at: "2026-10-17T22:00:00-03:00"
  nanoid:
    version: "^5.1.16"
    context7_id: "/ai/nanoid"
    fetched_at: "2026-10-17T22:00:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-16T18:16:26-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this slice. Context7 MCP was unavailable at write time; patterns documented from official docs and actual project usage. Re-fetch when the underlying TD changes.

---

## @aws-sdk/client-s3

**Source:** AWS SDK for JavaScript v3. Maps to TD-02 (S3 Multipart Presigned URLs).

### S3Client setup for MinIO

MinIO requires `forcePathStyle: true` — without it, the SDK uses virtual-hosted-style URLs (`bucket.endpoint`) which MinIO does not support by default.

```typescript
import { S3Client } from '@aws-sdk/client-s3';

const client = new S3Client({
  endpoint: 'http://minio:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
  forcePathStyle: true,
});
```

### Multipart upload lifecycle

The three-step flow: initiate → upload parts → complete (or abort).

```typescript
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';

// 1. Initiate — returns UploadId
const { UploadId } = await client.send(
  new CreateMultipartUploadCommand({ Bucket, Key }),
);

// 2. Upload parts (client-side via presigned URLs, or server-side)
await client.send(
  new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: 1, Body: chunk }),
);

// 3a. Complete — Parts must include PartNumber + ETag from each uploaded part
await client.send(
  new CompleteMultipartUploadCommand({
    Bucket, Key, UploadId,
    MultipartUpload: {
      Parts: [{ PartNumber: 1, ETag: '"abc..."' }],
    },
  }),
);

// 3b. Abort — cancels and deletes uploaded parts
await client.send(
  new AbortMultipartUploadCommand({ Bucket, Key, UploadId }),
);
```

### GetObjectCommand — streaming download

`response.Body` is a `Readable` stream. Use `stream/promises.pipeline` for disk writes:

```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const response = await client.send(new GetObjectCommand({ Bucket, Key }));
await pipeline(response.Body as Readable, createWriteStream(destPath));
```

### Key contracts

- `UploadId` can be `undefined` on `CreateMultipartUploadCommand` response — always guard.
- `ETag` values from part uploads include surrounding quotes — pass them as-is to `CompleteMultipartUploadCommand`.
- `ResponseContentDisposition` on `GetObjectCommand` sets the `Content-Disposition` header on the response — used for download vs. inline streaming.

### Testing notes

StorageService is mocked in E2E tests (`jest.fn()` overrides) since MinIO container is unavailable in the test environment. Integration tests (`storage.service.integration-spec.ts`) require a live MinIO container.

---

## @aws-sdk/s3-request-presigner

**Source:** AWS SDK for JavaScript v3. Maps to TD-02 (Presigned upload parts) and TD-03 (Presigned GET for streaming/download).

### getSignedUrl

Single function that presigns any S3 command:

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadPartCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// Presign an upload part (client uploads directly to MinIO)
const uploadUrl = await getSignedUrl(
  client,
  new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }),
  { expiresIn: 3600 },
);

// Presign a GET for streaming (302 redirect from API)
const streamUrl = await getSignedUrl(
  client,
  new GetObjectCommand({ Bucket, Key }),
  { expiresIn: 3600 },
);

// Presign a GET for download (with Content-Disposition: attachment)
const downloadUrl = await getSignedUrl(
  client,
  new GetObjectCommand({
    Bucket, Key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  }),
  { expiresIn: 3600 },
);
```

### Key contracts

- `expiresIn` is in seconds (default 900). Project uses 3600 (1 hour).
- The presigned URL includes the command's parameters (bucket, key, response headers) — they cannot be changed by the client.
- Works with any S3-compatible endpoint (MinIO, AWS S3) as long as the `S3Client` is configured correctly.

---

## @nestjs/bullmq

**Source:** NestJS Bull module v12 (BullMQ adapter). Maps to TD-01 (BullMQ + Redis).

### Module registration

Two-step: `forRootAsync` (Redis connection) at app level, `registerQueue` per queue in domain modules.

```typescript
import { BullModule } from '@nestjs/bullmq';

// AppModule / WorkerModule — Redis connection
BullModule.forRootAsync({
  imports: [ConfigModule],
  inject: [redisConfig.KEY],
  useFactory: (redisCfg: ConfigType<typeof redisConfig>) => ({
    connection: {
      host: redisCfg.host,
      port: redisCfg.port,
    },
  }),
}),

// VideosModule — queue declaration
BullModule.registerQueue({ name: 'video-processing' }),
```

### Queue injection — producer side

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

@Injectable()
export class VideosService {
  constructor(
    @InjectQueue('video-processing')
    private readonly processingQueue: Queue,
  ) {}

  async enqueueProcessing(videoId: string, storageKey: string): Promise<void> {
    await this.processingQueue.add('video.process', { videoId, storageKey });
  }
}
```

### Processor — consumer side (WorkerHost)

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    if (job.name !== 'video.process') return;
    // process job.data
  }
}
```

### Key contracts

- `@Processor` queue name must match `registerQueue({ name })` exactly.
- `WorkerHost` requires calling `super()` in constructor.
- The queue must be registered in BOTH the producer module (VideosModule) and the consumer module (WorkerModule).
- `@InjectQueue` token for mocking in tests: `getQueueToken('video-processing')` from `@nestjs/bullmq`.

### Testing notes

Unit tests mock the queue via `{ provide: getQueueToken('video-processing'), useValue: { add: jest.fn() } }`. The processor's `process` method is tested directly by calling it with a mock `Job` object.

---

## bullmq

**Source:** BullMQ v6, the underlying queue library. Maps to TD-01 (BullMQ + Redis).

### Core types used in the project

```typescript
import type { Queue, Job } from 'bullmq';

// Queue.add(jobName, data, opts?)
await queue.add('video.process', { videoId, storageKey });

// Job<T> — typed job data
interface VideoProcessJobData {
  videoId: string;
  storageKey: string;
}
// job.name, job.data, job.id
```

### Key contracts

- BullMQ v6 requires `ioredis` as the Redis client (not `redis` npm package).
- Job data must be JSON-serializable.
- The `@nestjs/bullmq` adapter handles Worker lifecycle (start/stop) — do not instantiate `Worker` directly when using NestJS.
- `transformIgnorePatterns` in Jest config must include `bullmq` and `@nestjs/bullmq` since they ship ESM; the project's `package.json` already configures this.

---

## ioredis

**Source:** ioredis v5, Redis client for Node.js. Maps to TD-01 (BullMQ + Redis) — used as BullMQ's connection layer.

### Connection in this project

ioredis is not used directly in application code — it is the connection driver for BullMQ. The connection is configured via `@nestjs/bullmq`'s `BullModule.forRootAsync`:

```typescript
// redis.config.ts
export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
}));

// BullModule passes { host, port } to ioredis internally
BullModule.forRootAsync({
  useFactory: (redisCfg) => ({
    connection: { host: redisCfg.host, port: redisCfg.port },
  }),
}),
```

### Key contracts

- Host must be the Docker Compose service name (`redis`), not `localhost`.
- Default port 6379.
- ioredis reconnects automatically on connection loss — BullMQ inherits this behavior.
- Health check: `docker compose exec redis redis-cli ping` → `PONG`.

---

## nanoid

**Source:** nanoid v5, URL-friendly unique string IDs. Maps to TD-05 (Unique Video URL, 11 chars).

### Usage in the project

```typescript
import { nanoid } from 'nanoid';

const public_id = nanoid(11); // 11-char URL-safe string (A-Za-z0-9_-)
```

### Key contracts

- nanoid v5 is **ESM-only**. The project's Jest config includes `nanoid` in `transformIgnorePatterns` to handle the ESM→CJS transform.
- Default alphabet: `A-Za-z0-9_-` (64 characters). With 11 chars, collision probability is ~1 in 139 billion at 1000 IDs/hour for 10 years.
- The `nanoid` function is non-cryptographic by default but uses `crypto.getRandomValues` (secure PRNG).
- Column `public_id` has a `UNIQUE` constraint in the database — nanoid collision (extremely unlikely) would result in a DB constraint error rather than a duplicate URL.

### Testing notes

nanoid is not mocked in unit tests — it generates a real random ID each time. Tests assert on the returned value's length (11) and format rather than specific values.
