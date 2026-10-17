import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from './entities/video.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Video]), ConfigModule],
})
export class VideosModule {}
