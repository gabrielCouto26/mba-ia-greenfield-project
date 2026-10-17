import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import { Video, VideoStatus } from '../entities/video.entity';
import { FfmpegService } from '../services/ffmpeg.service';
import { StorageService } from '../services/storage.service';

interface VideoProcessJobData {
  videoId: string;
  storageKey: string;
}

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly ffmpegService: FfmpegService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessJobData>): Promise<void> {
    if (job.name !== 'video.process') {
      return;
    }

    const { videoId, storageKey } = job.data;

    const video = await this.videoRepository.findOne({ where: { id: videoId } });
    if (!video) {
      throw new Error(`Video not found: ${videoId}`);
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamtube-'));
    const videoPath = path.join(tmpDir, 'input');
    const thumbnailPath = path.join(tmpDir, 'thumbnail.jpg');
    const thumbnailKey = `videos/${video.public_id}/thumbnail.jpg`;

    try {
      await this.storageService.downloadFile(storageKey, videoPath);
      const duration = await this.ffmpegService.extractMetadata(videoPath);
      await this.ffmpegService.generateThumbnail(videoPath, thumbnailPath);
      await this.storageService.uploadFile(thumbnailKey, thumbnailPath, 'image/jpeg');

      await this.videoRepository.update(videoId, {
        status: VideoStatus.READY,
        duration,
        thumbnail_key: thumbnailKey,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.videoRepository.update(videoId, {
        status: VideoStatus.ERROR,
        error_reason: errorMessage,
      });
      throw error;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
