import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import s3Config from '../../config/s3.config';
import { StorageService } from './storage.service';

jest.setTimeout(30000);

describe('StorageService (integration)', () => {
  let service: StorageService;
  let module: TestingModule;

  // S3_PUBLIC_ENDPOINT is set to http://localhost:9000 in .env so presigned URLs
  // carry the public host reachable from outside Docker.
  const publicHost = process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000';
  const publicHostname = new URL(publicHost).hostname;

  // Internal S3Client used in tests that need to PUT a real part inside Docker.
  // This client points to the Docker-internal minio host, separate from the
  // presignerClient under test (which uses the public endpoint).
  const internalTestClient = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'streamtube',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'streamtube123',
    },
    forcePathStyle: true,
  });
  const bucket = process.env.S3_BUCKET ?? 'streamtube';

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [s3Config] })],
      providers: [StorageService],
    }).compile();

    service = module.get(StorageService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('initiateMultipartUpload returns a non-empty uploadId string', async () => {
    // MinIO must be running: docker compose up -d minio
    const key = `test/integration/${Date.now()}/video.mp4`;
    const uploadId = await service.initiateMultipartUpload(key);

    expect(typeof uploadId).toBe('string');
    expect(uploadId.length).toBeGreaterThan(0);
  });

  it('getPresignedPartUrl returns a URL signed with the public endpoint', async () => {
    const key = `test/integration/${Date.now()}/video.mp4`;
    const uploadId = await service.initiateMultipartUpload(key);
    const url = await service.getPresignedPartUrl(key, uploadId, 1);

    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
    expect(new URL(url).hostname).toBe(publicHostname);

    // Clean up the pending upload
    await service.abortMultipartUpload(key, uploadId);
  });

  it('abortMultipartUpload completes without error', async () => {
    const key = `test/integration/${Date.now()}/video.mp4`;
    const uploadId = await service.initiateMultipartUpload(key);

    await expect(
      service.abortMultipartUpload(key, uploadId),
    ).resolves.toBeUndefined();
  });

  it('completeMultipartUpload finalizes a real upload on MinIO', async () => {
    // MinIO must be running: docker compose up -d minio
    // The part upload uses an internal presigned URL (minio:9000) so the fetch
    // works from inside the Docker container, while the initiate/complete calls
    // go through the StorageService (proving server-side ops use the internal client).
    const key = `test/integration/${Date.now()}/complete-test.mp4`;
    const uploadId = await service.initiateMultipartUpload(key);

    const internalPartCmd = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: 1,
    });
    const internalPresignedUrl = await getSignedUrl(
      internalTestClient,
      internalPartCmd,
      { expiresIn: 3600 },
    );
    const uploadRes = await fetch(internalPresignedUrl, {
      method: 'PUT',
      body: Buffer.from('x'),
      headers: { 'Content-Length': '1' },
    });
    const etag = uploadRes.headers.get('etag') ?? '';

    await expect(
      service.completeMultipartUpload(key, uploadId, [
        { part_number: 1, etag },
      ]),
    ).resolves.toBeUndefined();
  });

  it('getPresignedGetUrl returns a URL signed with the public endpoint', async () => {
    // MinIO must be running: docker compose up -d minio
    const key = `test/integration/${Date.now()}/video.mp4`;
    const url = await service.getPresignedGetUrl(key);

    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
    expect(new URL(url).hostname).toBe(publicHostname);
  });

  it('getPresignedGetUrl with responseContentDisposition includes param in URL and uses public host', async () => {
    // MinIO must be running: docker compose up -d minio
    const key = `test/integration/${Date.now()}/video.mp4`;
    const url = await service.getPresignedGetUrl(key, {
      responseContentDisposition: 'attachment',
    });

    expect(url).toContain('response-content-disposition');
    expect(new URL(url).hostname).toBe(publicHostname);
  });
});
