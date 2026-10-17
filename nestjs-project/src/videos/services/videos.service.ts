import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { nanoid } from 'nanoid';
import { ChannelsService } from '../../channels/channels.service';
import {
  NotChannelOwnerException,
  UploadNotInProgressException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../../common/exceptions/domain.exception';
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
    @InjectQueue('video-processing')
    private readonly processingQueue: Queue,
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

  async presignPart(
    publicId: string,
    partNumber: number,
    userId: string,
  ): Promise<{ presigned_url: string }> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });
    if (!video) throw new VideoNotFoundException();

    const channel = await this.channelsService.findById(video.channel_id);
    if (!channel || channel.user_id !== userId) throw new NotChannelOwnerException();

    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new UploadNotInProgressException();
    }

    const presigned_url = await this.storageService.getPresignedPartUrl(
      video.storage_key,
      video.upload_id,
      partNumber,
    );
    return { presigned_url };
  }

  async abortUpload(publicId: string, userId: string): Promise<void> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });
    if (!video) throw new VideoNotFoundException();

    const channel = await this.channelsService.findById(video.channel_id);
    if (!channel || channel.user_id !== userId) throw new NotChannelOwnerException();

    if (video.upload_id) {
      await this.storageService.abortMultipartUpload(
        video.storage_key,
        video.upload_id,
      );
    }

    await this.videoRepository.update({ id: video.id }, { upload_id: null });
  }

  async getStreamUrl(publicId: string): Promise<string> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });
    if (!video) throw new VideoNotFoundException();
    if (video.status !== VideoStatus.READY) throw new VideoNotReadyException();

    return this.storageService.getPresignedGetUrl(video.storage_key);
  }

  async getDownloadUrl(publicId: string): Promise<string> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });
    if (!video) throw new VideoNotFoundException();
    if (video.status !== VideoStatus.READY) throw new VideoNotReadyException();

    return this.storageService.getPresignedGetUrl(video.storage_key, {
      responseContentDisposition: 'attachment',
    });
  }

  async completeUpload(
    publicId: string,
    parts: Array<{ part_number: number; etag: string }>,
    userId: string,
  ): Promise<{ id: string; public_id: string; status: VideoStatus }> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });
    if (!video) throw new VideoNotFoundException();

    const channel = await this.channelsService.findById(video.channel_id);
    if (!channel || channel.user_id !== userId) throw new NotChannelOwnerException();

    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new UploadNotInProgressException();
    }

    await this.storageService.completeMultipartUpload(
      video.storage_key,
      video.upload_id,
      parts,
    );

    await this.videoRepository.update(
      { id: video.id },
      { status: VideoStatus.PROCESSING, upload_id: null },
    );

    await this.processingQueue.add('video.process', {
      videoId: video.id,
      storageKey: video.storage_key,
    });

    return { id: video.id, public_id: video.public_id, status: VideoStatus.PROCESSING };
  }
}
