import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ChannelsModule } from '../channels/channels.module';
import { VideosController } from './controllers/videos.controller';
import { Video } from './entities/video.entity';
import { StorageService } from './services/storage.service';
import { VideosService } from './services/videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ConfigModule,
    ChannelsModule,
    BullModule.registerQueue({ name: 'video-processing' }),
  ],
  controllers: [VideosController],
  providers: [StorageService, VideosService],
})
export class VideosModule {}
