import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';

describe('VideosModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
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
        VideosModule,
      ],
    }).compile();

    expect(module).toBeDefined();
    await module.close();
  });
});
