import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import s3Config from '../../config/s3.config';
import { StorageService } from './storage.service';

jest.setTimeout(30000);

describe('StorageService (integration)', () => {
  let service: StorageService;
  let module: TestingModule;

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

  it('getPresignedPartUrl returns a signed URL string', async () => {
    const key = `test/integration/${Date.now()}/video.mp4`;
    const uploadId = await service.initiateMultipartUpload(key);
    const url = await service.getPresignedPartUrl(key, uploadId, 1);

    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('abortMultipartUpload completes without error', async () => {
    const key = `test/integration/${Date.now()}/video.mp4`;
    const uploadId = await service.initiateMultipartUpload(key);

    await expect(service.abortMultipartUpload(key, uploadId)).resolves.toBeUndefined();
  });
});
