import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Channel } from './channels/entities/channel.entity';
import { User } from './users/entities/user.entity';
import { Video } from './videos/entities/video.entity';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import s3Config from './config/s3.config';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should compile and resolve Video relation graph (Channel, User) without entity metadata errors', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, redisConfig, s3Config],
        }),
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
        WorkerModule,
      ],
    }).compile();

    expect(module).toBeDefined();

    await module.close();
  });
});
