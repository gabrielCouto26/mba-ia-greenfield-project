import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { StorageService } from '../src/videos/services/storage.service';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

const MOCK_PRESIGNED_THUMBNAIL_URL =
  'http://minio:9000/streamtube/videos/infovid1abc/thumbnail.jpg?X-Amz-Signature=thumbtest';

describe('videos-info', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

  const mockGetPresignedGetUrl = jest
    .fn()
    .mockResolvedValue(MOCK_PRESIGNED_THUMBNAIL_URL);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({
        initiateMultipartUpload: jest.fn().mockResolvedValue('mock-upload-id'),
        getPresignedGetUrl: mockGetPresignedGetUrl,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    mockGetPresignedGetUrl.mockClear();
  });

  async function captureConfirmationToken(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    return capturedToken;
  }

  async function getChannel(): Promise<Channel> {
    const email = 'info@test.com';
    const token = await captureConfirmationToken(email);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' });
    const userId: string = loginRes.body.sub;
    return dataSource
      .getRepository(Channel)
      .findOneOrFail({ where: { user_id: userId } });
  }

  async function createVideoWithThumbnail(channelId: string): Promise<Video> {
    const videoRepo = dataSource.getRepository(Video);
    return videoRepo.save(
      videoRepo.create({
        public_id: 'infovid1abc',
        title: 'Info Test Video',
        storage_key: 'videos/infovid1abc/original',
        thumbnail_key: 'videos/infovid1abc/thumbnail.jpg',
        status: VideoStatus.READY,
        duration: 95.3,
        channel_id: channelId,
        upload_id: null,
      }),
    );
  }

  async function createVideoWithoutThumbnail(
    channelId: string,
  ): Promise<Video> {
    const videoRepo = dataSource.getRepository(Video);
    return videoRepo.save(
      videoRepo.create({
        public_id: 'infovid2abc',
        title: 'No Thumb Video',
        storage_key: 'videos/infovid2abc/original',
        thumbnail_key: null,
        status: VideoStatus.READY,
        duration: null,
        channel_id: channelId,
        upload_id: null,
      }),
    );
  }

  describe('1. Successful Retrieval', () => {
    it('1.1. return-video-with-all-fields', async () => {
      const channel = await getChannel();
      const video = await createVideoWithThumbnail(channel.id);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}`)
        .expect(200);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('public_id', video.public_id);
      expect(res.body).toHaveProperty('title', video.title);
      expect(res.body).toHaveProperty('status', VideoStatus.READY);
      expect(res.body).toHaveProperty('duration', video.duration);
      expect(res.body).toHaveProperty('thumbnail_url');
      expect(res.body).toHaveProperty('created_at');
    });

    it('1.2. return-thumbnail-as-presigned-url', async () => {
      const channel = await getChannel();
      const video = await createVideoWithThumbnail(channel.id);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}`)
        .expect(200);

      expect(typeof res.body.thumbnail_url).toBe('string');
      expect(res.body.thumbnail_url).toContain('minio');
    });
  });

  describe('2. Video Without Thumbnail', () => {
    it('2.1. return-null-thumbnail-when-absent', async () => {
      const channel = await getChannel();
      const video = await createVideoWithoutThumbnail(channel.id);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}`)
        .expect(200);

      expect(res.body.thumbnail_url).toBeNull();
    });
  });

  describe('3. Not Found', () => {
    it('3.1. return-404-for-missing-video', async () => {
      const res = await request(app.getHttpServer())
        .get('/videos/nonexistent1')
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
