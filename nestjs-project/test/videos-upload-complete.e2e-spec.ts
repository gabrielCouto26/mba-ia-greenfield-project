import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { StorageService } from '../src/videos/services/storage.service';
import { Channel } from '../src/channels/entities/channel.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('videos-upload-complete', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }) };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({
        initiateMultipartUpload: jest
          .fn()
          .mockResolvedValue('mock-upload-id-e2e'),
        getPresignedPartUrl: jest
          .fn()
          .mockResolvedValue('https://mock-presigned-url.example.com/part'),
        abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
        completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(getQueueToken('video-processing'))
      .useValue(mockQueue)
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
    mockQueue.add.mockClear();
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
      .mockImplementationOnce(async (_e: unknown, _n: unknown, t: unknown) => {
        capturedToken = t as string;
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

  async function getChannelIdForUser(userId: string): Promise<string> {
    const channel = await dataSource
      .getRepository(Channel)
      .findOneOrFail({ where: { user_id: userId } });
    return channel.id;
  }

  async function getUserIdFromToken(access_token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${access_token}`);
    return res.body.sub;
  }

  async function initiateDraftUpload(
    access_token: string,
    channelId: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${access_token}`)
      .send({
        filename: 'test-video.mp4',
        mimetype: 'video/mp4',
        size: 1048576,
        channel_id: channelId,
      })
      .expect(201);
    return res.body.public_id as string;
  }

  describe('1. Successful Completion', () => {
    it('1.1. complete-upload-transitions-to-processing', async () => {
      const { access_token } = await registerConfirmAndLogin('owner@test.com');
      const userId = await getUserIdFromToken(access_token);
      const channelId = await getChannelIdForUser(userId);
      const publicId = await initiateDraftUpload(access_token, channelId);

      const res = await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/complete`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ parts: [{ part_number: 1, etag: '"abc123etag"' }] })
        .expect(200);

      expect(res.body.status).toBe('processing');

      const video = await dataSource
        .getRepository(Video)
        .findOneOrFail({ where: { public_id: publicId } });
      expect(video.status).toBe(VideoStatus.PROCESSING);
    });

    it('1.2. complete-upload-enqueues-processing-job', async () => {
      const { access_token } = await registerConfirmAndLogin('owner2@test.com');
      const userId = await getUserIdFromToken(access_token);
      const channelId = await getChannelIdForUser(userId);
      const publicId = await initiateDraftUpload(access_token, channelId);

      const video = await dataSource
        .getRepository(Video)
        .findOneOrFail({ where: { public_id: publicId } });

      await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/complete`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ parts: [{ part_number: 1, etag: '"abc123etag"' }] })
        .expect(200);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'video.process',
        expect.objectContaining({
          videoId: video.id,
          storageKey: video.storage_key,
        }),
      );
    });
  });

  describe('2. State Validation', () => {
    it('2.1. reject-complete-on-non-draft-video', async () => {
      const { access_token } = await registerConfirmAndLogin('owner3@test.com');
      const userId = await getUserIdFromToken(access_token);
      const channelId = await getChannelIdForUser(userId);
      const publicId = await initiateDraftUpload(access_token, channelId);

      await dataSource
        .getRepository(Video)
        .update({ public_id: publicId }, { status: VideoStatus.PROCESSING });

      const res = await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/complete`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ parts: [{ part_number: 1, etag: '"abc123etag"' }] })
        .expect(409);

      expect(res.body.error).toBe('UPLOAD_NOT_IN_PROGRESS');
    });
  });

  describe('3. Authorization Failures', () => {
    it('3.1. reject-complete-by-non-owner', async () => {
      const { access_token: tokenA } =
        await registerConfirmAndLogin('userA@test.com');
      const { access_token: tokenB } =
        await registerConfirmAndLogin('userB@test.com');
      const userAId = await getUserIdFromToken(tokenA);
      const channelAId = await getChannelIdForUser(userAId);
      const publicId = await initiateDraftUpload(tokenA, channelAId);

      const res = await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/complete`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ parts: [{ part_number: 1, etag: '"abc123etag"' }] })
        .expect(403);

      expect(res.body.error).toBe('NOT_CHANNEL_OWNER');
    });
  });
});
