import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { nanoid } from 'nanoid';
import { ChannelsService } from '../../channels/channels.service';
import { NotChannelOwnerException } from '../../common/exceptions/domain.exception';
import type { CreateVideoDto } from '../dto/create-video.dto';
import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from './storage.service';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
  ) {}

  async create(
    dto: CreateVideoDto,
    userId: string,
  ): Promise<{ id: string; public_id: string; status: VideoStatus }> {
    const channel = await this.channelsService.findById(dto.channel_id);
    if (!channel || channel.user_id !== userId) {
      throw new NotChannelOwnerException();
    }

    const public_id = nanoid(11);
    const storage_key = `videos/${public_id}/original`;

    const upload_id = await this.storageService.initiateMultipartUpload(
      storage_key,
    );

    const video = this.videoRepository.create({
      public_id,
      storage_key,
      upload_id,
      status: VideoStatus.DRAFT,
      channel_id: dto.channel_id,
      original_filename: dto.filename,
      mimetype: dto.mimetype,
      size_bytes: String(dto.size),
    });

    const saved = await this.videoRepository.save(video);

    return { id: saved.id, public_id: saved.public_id, status: saved.status };
  }
}
