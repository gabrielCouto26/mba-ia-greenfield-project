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

const MOCK_PRESIGNED_STREAM_URL =
  'http://minio:9000/streamtube/videos/testvid1/original?X-Amz-Signature=streamtest';
const MOCK_PRESIGNED_DOWNLOAD_URL =
  'http://minio:9000/streamtube/videos/testvid1/original?response-content-disposition=attachment&X-Amz-Signature=dltest';

describe('videos-streaming', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

  const mockGetPresignedGetUrl = jest
    .fn()
    .mockImplementation(
      (_key: string, options?: { responseContentDisposition?: string }) =>
        options?.responseContentDisposition
          ? Promise.resolve(MOCK_PRESIGNED_DOWNLOAD_URL)
          : Promise.resolve(MOCK_PRESIGNED_STREAM_URL),
    );

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

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<{ access_token: string }> {
    const token = await captureConfirmationToken(email, password);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return { access_token: res.body.access_token };
  }

  async function createReadyVideo(channelId: string): Promise<Video> {
    const videoRepo = dataSource.getRepository(Video);
    return videoRepo.save(
      videoRepo.create({
        public_id: 'testvid1abc',
        storage_key: 'videos/testvid1abc/original',
        status: VideoStatus.READY,
        channel_id: channelId,
        upload_id: null,
      }),
    );
  }

  async function getChannelForUser(email: string): Promise<Channel> {
    const { access_token } = await registerConfirmAndLogin(email);
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${access_token}`);
    const userId: string = meRes.body.sub;
    return dataSource
      .getRepository(Channel)
      .findOneOrFail({ where: { user_id: userId } });
  }

  describe('1. Stream — Success', () => {
    it('1.1. stream-redirects-to-presigned-url', async () => {
      const channel = await getChannelForUser('stream@test.com');
      const video = await createReadyVideo(channel.id);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/stream`)
        .redirects(0)
        .expect(302);

      expect(res.headers.location).toBeDefined();
      expect(res.headers.location).toContain('minio');
    });
  });

  describe('2. Download — Success', () => {
    it('2.1. download-redirects-with-content-disposition', async () => {
      const channel = await getChannelForUser('download@test.com');
      const video = await createReadyVideo(channel.id);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/download`)
        .redirects(0)
        .expect(302);

      expect(res.headers.location).toBeDefined();
      expect(res.headers.location).toContain('response-content-disposition');
      expect(res.headers.location).toContain('attachment');
    });
  });

  describe('3. Not Found', () => {
    it('3.1. stream-returns-404-for-missing-video', async () => {
      const res = await request(app.getHttpServer())
        .get('/videos/nonexistent1/stream')
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('3.2. download-returns-404-for-missing-video', async () => {
      const res = await request(app.getHttpServer())
        .get('/videos/nonexistent1/download')
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('4. Video Not Ready', () => {
    it('4.1. stream-returns-409-for-non-ready-video', async () => {
      const channel = await getChannelForUser('notready1@test.com');
      const videoRepo = dataSource.getRepository(Video);
      const video = await videoRepo.save(
        videoRepo.create({
          public_id: 'draftvidab1',
          storage_key: 'videos/draftvidabc1/original',
          status: VideoStatus.DRAFT,
          channel_id: channel.id,
          upload_id: null,
        }),
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/stream`)
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });

    it('4.2. download-returns-409-for-non-ready-video', async () => {
      const channel = await getChannelForUser('notready2@test.com');
      const videoRepo = dataSource.getRepository(Video);
      const video = await videoRepo.save(
        videoRepo.create({
          public_id: 'procvidab12',
          storage_key: 'videos/procvidab12/original',
          status: VideoStatus.PROCESSING,
          channel_id: channel.id,
          upload_id: null,
        }),
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/download`)
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });
  });
});
