import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Channel } from '../channels/entities/channel.entity';
import redisConfig from '../config/redis.config';
import s3Config from '../config/s3.config';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';

describe('VideosModule', () => {
  it('should compile successfully with BullMQ registered', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [s3Config, redisConfig] }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST ?? 'db',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USERNAME ?? 'streamtube',
          password: process.env.DB_PASSWORD ?? 'streamtube',
          database: process.env.DB_DATABASE ?? 'streamtube',
          entities: [Video, Channel, User],
          synchronize: true,
        }),
        BullModule.forRoot({
          connection: {
            host: process.env.REDIS_HOST ?? 'redis',
            port: Number(process.env.REDIS_PORT ?? 6379),
            lazyConnect: true,
          },
        }),
        VideosModule,
      ],
    }).compile();

    expect(module).toBeDefined();

    const queue = module.get('BullQueue_video-processing', { strict: false });
    expect(queue).toBeDefined();

    await module.close();
  });
});
