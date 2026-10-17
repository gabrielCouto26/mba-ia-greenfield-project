import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import { Video, VideoStatus } from '../entities/video.entity';
import { FfmpegService } from '../services/ffmpeg.service';
import { StorageService } from '../services/storage.service';
import { VideoProcessor } from './video.processor';

const mockVideoRepository = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockFfmpegService = () => ({
  extractMetadata: jest.fn(),
  generateThumbnail: jest.fn(),
});

const mockStorageService = () => ({
  downloadFile: jest.fn(),
  uploadFile: jest.fn(),
});

function makeJob(data: object, name = 'video.process'): Job {
  return { name, data } as unknown as Job;
}

describe('VideoProcessor', () => {
  let processor: VideoProcessor;
  let videoRepo: jest.Mocked<Pick<Repository<Video>, 'findOne' | 'update'>>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let storageService: jest.Mocked<
    Pick<StorageService, 'downloadFile' | 'uploadFile'>
  >;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoProcessor,
        { provide: getRepositoryToken(Video), useFactory: mockVideoRepository },
        { provide: FfmpegService, useFactory: mockFfmpegService },
        { provide: StorageService, useFactory: mockStorageService },
      ],
    }).compile();

    processor = module.get<VideoProcessor>(VideoProcessor);
    videoRepo = module.get(getRepositoryToken(Video));
    ffmpegService = module.get(FfmpegService);
    storageService = module.get(StorageService);
  });

  describe('process — success', () => {
    it('should update video to READY with duration and thumbnail_key', async () => {
      const video: Partial<Video> = {
        id: 'uuid-1',
        public_id: 'abc123',
        status: VideoStatus.PROCESSING,
      };

      videoRepo.findOne.mockResolvedValue(video as Video);
      storageService.downloadFile.mockResolvedValue(undefined);
      ffmpegService.extractMetadata.mockResolvedValue(120.5);
      ffmpegService.generateThumbnail.mockResolvedValue(undefined);
      storageService.uploadFile.mockResolvedValue(undefined);
      videoRepo.update.mockResolvedValue({ affected: 1 } as any);

      const job = makeJob({
        videoId: 'uuid-1',
        storageKey: 'videos/abc123/original',
      });
      await processor.process(job);

      expect(videoRepo.update).toHaveBeenCalledWith('uuid-1', {
        status: VideoStatus.READY,
        duration: 120.5,
        thumbnail_key: 'videos/abc123/thumbnail.jpg',
      });
    });
  });

  describe('process — error', () => {
    it('should update video to ERROR with error_reason when FFmpeg fails', async () => {
      const video: Partial<Video> = {
        id: 'uuid-2',
        public_id: 'xyz456',
        status: VideoStatus.PROCESSING,
      };

      videoRepo.findOne.mockResolvedValue(video as Video);
      storageService.downloadFile.mockResolvedValue(undefined);
      ffmpegService.extractMetadata.mockRejectedValue(
        new Error('Invalid video format'),
      );
      videoRepo.update.mockResolvedValue({ affected: 1 } as any);

      const job = makeJob({
        videoId: 'uuid-2',
        storageKey: 'videos/xyz456/original',
      });

      await expect(processor.process(job)).rejects.toThrow(
        'Invalid video format',
      );

      expect(videoRepo.update).toHaveBeenCalledWith('uuid-2', {
        status: VideoStatus.ERROR,
        error_reason: 'Invalid video format',
      });
    });
  });

  describe('process — unknown job name', () => {
    it('should return without processing for unknown job names', async () => {
      const job = makeJob(
        { videoId: 'uuid-3', storageKey: 'key' },
        'other.job',
      );
      await processor.process(job);
      expect(videoRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
