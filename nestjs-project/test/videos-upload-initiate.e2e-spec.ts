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
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('videos-upload-initiate', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({
        initiateMultipartUpload: jest
          .fn()
          .mockResolvedValue('mock-upload-id-e2e'),
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

  describe('1. Successful Upload Initiation', () => {
    it('1.1. create-video-as-draft — returns 201 with public_id (11 chars), status draft, and valid UUID id', async () => {
      const { access_token } = await registerConfirmAndLogin('owner@test.com');
      const userId = await getUserIdFromToken(access_token);
      const channelId = await getChannelIdForUser(userId);

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          filename: 'my-video.mp4',
          mimetype: 'video/mp4',
          size: 1048576,
          channel_id: channelId,
        })
        .expect(201);

      expect(res.body.public_id).toHaveLength(11);
      expect(res.body.status).toBe('draft');
      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('2. Authentication Failures', () => {
    it('2.1. reject-without-auth-token — returns 401', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send({
          filename: 'my-video.mp4',
          mimetype: 'video/mp4',
          size: 1048576,
          channel_id: 'some-uuid',
        })
        .expect(401);
    });
  });

  describe('3. Authorization Failures', () => {
    it('3.1. reject-non-owner-channel — returns 403 NOT_CHANNEL_OWNER', async () => {
      const { access_token: tokenA } =
        await registerConfirmAndLogin('userA@test.com');
      const { access_token: tokenB } =
        await registerConfirmAndLogin('userB@test.com');
      const userBId = await getUserIdFromToken(tokenB);
      const channelBId = await getChannelIdForUser(userBId);

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          filename: 'my-video.mp4',
          mimetype: 'video/mp4',
          size: 1048576,
          channel_id: channelBId,
        })
        .expect(403);

      expect(res.body.error).toBe('NOT_CHANNEL_OWNER');
    });
  });

  describe('4. Validation Failures', () => {
    it('4.1. reject-size-exceeding-limit — returns 400 for size > 10 GiB', async () => {
      const { access_token } = await registerConfirmAndLogin('owner2@test.com');
      const userId = await getUserIdFromToken(access_token);
      const channelId = await getChannelIdForUser(userId);

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          filename: 'huge-video.mp4',
          mimetype: 'video/mp4',
          size: 10737418241,
          channel_id: channelId,
        })
        .expect(400);

      expect(res.body).toBeDefined();
    });
  });
});
