import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { StorageService } from '../src/videos/services/storage.service';
import { Channel } from '../src/channels/entities/channel.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('videos-upload-management', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({
        initiateMultipartUpload: jest.fn().mockResolvedValue('mock-upload-id-e2e'),
        getPresignedPartUrl: jest
          .fn()
          .mockResolvedValue('https://mock-presigned-url.example.com/part'),
        abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
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

  describe('1. Presign Part — Success', () => {
    it('1.1. presign-part-returns-url — returns 200 with presigned_url', async () => {
      const { access_token } = await registerConfirmAndLogin('owner@test.com');
      const userId = await getUserIdFromToken(access_token);
      const channelId = await getChannelIdForUser(userId);
      const publicId = await initiateDraftUpload(access_token, channelId);

      const res = await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/presign-part`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ part_number: 1 })
        .expect(200);

      expect(typeof res.body.presigned_url).toBe('string');
      expect(res.body.presigned_url.length).toBeGreaterThan(0);
    });
  });

  describe('2. Presign Part — State Validation', () => {
    it('2.1. presign-part-rejects-non-draft-video — returns 409 UPLOAD_NOT_IN_PROGRESS', async () => {
      const { access_token } = await registerConfirmAndLogin('owner2@test.com');
      const userId = await getUserIdFromToken(access_token);
      const channelId = await getChannelIdForUser(userId);
      const publicId = await initiateDraftUpload(access_token, channelId);

      // Transition video to processing status to simulate non-draft
      await dataSource
        .getRepository(Video)
        .update({ public_id: publicId }, { status: VideoStatus.PROCESSING });

      const res = await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/presign-part`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ part_number: 1 })
        .expect(409);

      expect(res.body.error).toBe('UPLOAD_NOT_IN_PROGRESS');
    });
  });

  describe('3. Abort Upload', () => {
    it('3.1. abort-upload-clears-upload-id — returns 204 and clears upload_id', async () => {
      const { access_token } = await registerConfirmAndLogin('owner3@test.com');
      const userId = await getUserIdFromToken(access_token);
      const channelId = await getChannelIdForUser(userId);
      const publicId = await initiateDraftUpload(access_token, channelId);

      await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/abort`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(204);

      const video = await dataSource
        .getRepository(Video)
        .findOneOrFail({ where: { public_id: publicId } });
      expect(video.upload_id).toBeNull();
    });
  });

  describe('4. Authorization Failures', () => {
    it('4.1. presign-part-rejects-non-owner — returns 403 NOT_CHANNEL_OWNER', async () => {
      const { access_token: tokenA } = await registerConfirmAndLogin('userA@test.com');
      const { access_token: tokenB } = await registerConfirmAndLogin('userB@test.com');
      const userAId = await getUserIdFromToken(tokenA);
      const channelAId = await getChannelIdForUser(userAId);
      const publicId = await initiateDraftUpload(tokenA, channelAId);

      const res = await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/presign-part`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ part_number: 1 })
        .expect(403);

      expect(res.body.error).toBe('NOT_CHANNEL_OWNER');
    });

    it('4.2. abort-rejects-non-owner — returns 403 NOT_CHANNEL_OWNER', async () => {
      const { access_token: tokenA } = await registerConfirmAndLogin('userC@test.com');
      const { access_token: tokenB } = await registerConfirmAndLogin('userD@test.com');
      const userAId = await getUserIdFromToken(tokenA);
      const channelAId = await getChannelIdForUser(userAId);
      const publicId = await initiateDraftUpload(tokenA, channelAId);

      const res = await request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/abort`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);

      expect(res.body.error).toBe('NOT_CHANNEL_OWNER');
    });
  });

  describe('5. Not Found', () => {
    it('5.1. presign-part-returns-404-for-missing-video', async () => {
      const { access_token } = await registerConfirmAndLogin('owner5@test.com');

      const res = await request(app.getHttpServer())
        .post('/videos/nonexistent1/upload/presign-part')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ part_number: 1 })
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('5.2. abort-returns-404-for-missing-video', async () => {
      const { access_token } = await registerConfirmAndLogin('owner6@test.com');

      const res = await request(app.getHttpServer())
        .post('/videos/nonexistent1/upload/abort')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
