import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import mailConfig from './config/mail.config';
import redisConfig from './config/redis.config';
import s3Config from './config/s3.config';
import { envValidationSchema } from './config/env.validation';
import { Video } from './videos/entities/video.entity';
import { VideoProcessor } from './videos/processors/video.processor';
import { FfmpegService } from './videos/services/ffmpeg.service';
import { StorageService } from './videos/services/storage.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, databaseConfig, mailConfig, redisConfig, s3Config],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Video]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [redisConfig.KEY],
      useFactory: (redisCfg: ConfigType<typeof redisConfig>) => ({
        connection: {
          host: redisCfg.host,
          port: redisCfg.port,
        },
      }),
    }),
    BullModule.registerQueue({ name: 'video-processing' }),
  ],
  providers: [FfmpegService, StorageService, VideoProcessor],
})
export class WorkerModule {}
