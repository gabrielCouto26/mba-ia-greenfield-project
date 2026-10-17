import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { ChannelsService } from '../../channels/channels.service';
import {
  NotChannelOwnerException,
  UploadNotInProgressException,
  VideoNotFoundException,
} from '../../common/exceptions/domain.exception';
import { CreateVideoDto } from '../dto/create-video.dto';
import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from './storage.service';
import { VideosService } from './videos.service';

const mockVideoRepository = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockStorageService = () => ({
  initiateMultipartUpload: jest.fn(),
  getPresignedPartUrl: jest.fn(),
  abortMultipartUpload: jest.fn(),
  completeMultipartUpload: jest.fn(),
});

const mockChannelsService = () => ({
  findById: jest.fn(),
});

const mockProcessingQueue = () => ({
  add: jest.fn(),
});

describe('VideosService', () => {
  let service: VideosService;
  let videoRepo: jest.Mocked<Pick<Repository<Video>, 'create' | 'save' | 'findOne' | 'update'>>;
  let storageService: jest.Mocked<{
    initiateMultipartUpload: (key: string) => Promise<string>;
    getPresignedPartUrl: (key: string, uploadId: string, part: number) => Promise<string>;
    abortMultipartUpload: (key: string, uploadId: string) => Promise<void>;
    completeMultipartUpload: (key: string, uploadId: string, parts: Array<{ part_number: number; etag: string }>) => Promise<void>;
  }>;
  let channelsService: jest.Mocked<{ findById: (id: string) => Promise<{ id: string; user_id: string } | null> }>;
  let processingQueue: jest.Mocked<{ add: (name: string, data: object) => Promise<unknown> }>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useFactory: mockVideoRepository },
        { provide: StorageService, useFactory: mockStorageService },
        { provide: ChannelsService, useFactory: mockChannelsService },
        { provide: getQueueToken('video-processing'), useFactory: mockProcessingQueue },
      ],
    }).compile();

    service = module.get(VideosService);
    videoRepo = module.get(getRepositoryToken(Video));
    storageService = module.get(StorageService);
    channelsService = module.get(ChannelsService);
    processingQueue = module.get(getQueueToken('video-processing'));
  });

  describe('create', () => {
    const userId = 'user-uuid-123';
    const channelId = 'channel-uuid-456';
    const dto: CreateVideoDto = {
      filename: 'my-video.mp4',
      mimetype: 'video/mp4',
      size: 1048576,
      channel_id: channelId,
    };

    it('creates a video with status draft and persists upload_id', async () => {
      const fakeUploadId = 'minio-upload-id-xyz';
      const fakeVideo = {
        id: 'video-uuid-789',
        public_id: 'abc12345678',
        status: VideoStatus.DRAFT,
        upload_id: fakeUploadId,
      };

      channelsService.findById.mockResolvedValue({
        id: channelId,
        user_id: userId,
      });
      storageService.initiateMultipartUpload.mockResolvedValue(fakeUploadId);
      (videoRepo.create as jest.Mock).mockReturnValue(fakeVideo);
      (videoRepo.save as jest.Mock).mockResolvedValue(fakeVideo);

      const result = await service.create(dto, userId);

      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.id).toBe(fakeVideo.id);
      expect(typeof result.public_id).toBe('string');
      expect(result.public_id.length).toBe(11);

      expect(videoRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          upload_id: fakeUploadId,
          status: VideoStatus.DRAFT,
          channel_id: channelId,
        }),
      );
    });

    it('generates a public_id of exactly 11 characters', async () => {
      channelsService.findById.mockResolvedValue({
        id: channelId,
        user_id: userId,
      });
      storageService.initiateMultipartUpload.mockResolvedValue('upload-id');
      (videoRepo.create as jest.Mock).mockImplementation((data) => data);
      (videoRepo.save as jest.Mock).mockImplementation(async (data) => ({
        ...data,
        id: 'video-uuid',
      }));

      const result = await service.create(dto, userId);

      expect(result.public_id).toHaveLength(11);
    });

    it('throws NotChannelOwnerException when channel belongs to another user', async () => {
      channelsService.findById.mockResolvedValue({
        id: channelId,
        user_id: 'other-user-id',
      });

      await expect(service.create(dto, userId)).rejects.toThrow(
        NotChannelOwnerException,
      );
      expect(storageService.initiateMultipartUpload).not.toHaveBeenCalled();
    });

    it('throws NotChannelOwnerException when channel does not exist', async () => {
      channelsService.findById.mockResolvedValue(null);

      await expect(service.create(dto, userId)).rejects.toThrow(
        NotChannelOwnerException,
      );
    });
  });

  describe('presignPart', () => {
    const userId = 'user-uuid-123';
    const publicId = 'abc12345678';
    const draftVideo = {
      id: 'video-uuid-789',
      public_id: publicId,
      channel_id: 'channel-uuid-456',
      storage_key: `videos/${publicId}/original`,
      upload_id: 'minio-upload-id',
      status: VideoStatus.DRAFT,
    };

    it('returns presigned_url for valid owner + draft video', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(draftVideo);
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: userId,
      });
      storageService.getPresignedPartUrl.mockResolvedValue('https://presigned.example.com/part1');

      const result = await service.presignPart(publicId, 1, userId);

      expect(result.presigned_url).toBe('https://presigned.example.com/part1');
      expect(storageService.getPresignedPartUrl).toHaveBeenCalledWith(
        draftVideo.storage_key,
        draftVideo.upload_id,
        1,
      );
    });

    it('throws VideoNotFoundException when video does not exist', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.presignPart(publicId, 1, userId)).rejects.toThrow(
        VideoNotFoundException,
      );
      expect(channelsService.findById).not.toHaveBeenCalled();
    });

    it('throws NotChannelOwnerException when user does not own the channel', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(draftVideo);
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: 'other-user-id',
      });

      await expect(service.presignPart(publicId, 1, userId)).rejects.toThrow(
        NotChannelOwnerException,
      );
    });

    it('throws UploadNotInProgressException when status is not draft', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue({
        ...draftVideo,
        status: VideoStatus.PROCESSING,
      });
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: userId,
      });

      await expect(service.presignPart(publicId, 1, userId)).rejects.toThrow(
        UploadNotInProgressException,
      );
    });

    it('throws UploadNotInProgressException when upload_id is null', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue({
        ...draftVideo,
        upload_id: null,
      });
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: userId,
      });

      await expect(service.presignPart(publicId, 1, userId)).rejects.toThrow(
        UploadNotInProgressException,
      );
    });
  });

  describe('abortUpload', () => {
    const userId = 'user-uuid-123';
    const publicId = 'abc12345678';
    const draftVideo = {
      id: 'video-uuid-789',
      public_id: publicId,
      channel_id: 'channel-uuid-456',
      storage_key: `videos/${publicId}/original`,
      upload_id: 'minio-upload-id',
      status: VideoStatus.DRAFT,
    };

    it('aborts S3 upload and clears upload_id', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(draftVideo);
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: userId,
      });
      storageService.abortMultipartUpload.mockResolvedValue(undefined);
      (videoRepo.update as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.abortUpload(publicId, userId);

      expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
        draftVideo.storage_key,
        draftVideo.upload_id,
      );
      expect(videoRepo.update).toHaveBeenCalledWith(
        { id: draftVideo.id },
        { upload_id: null },
      );
    });

    it('throws VideoNotFoundException when video does not exist', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.abortUpload(publicId, userId)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws NotChannelOwnerException when user does not own the channel', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(draftVideo);
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: 'other-user-id',
      });

      await expect(service.abortUpload(publicId, userId)).rejects.toThrow(
        NotChannelOwnerException,
      );
    });
  });

  describe('completeUpload', () => {
    const userId = 'user-uuid-123';
    const publicId = 'abc12345678';
    const draftVideo = {
      id: 'video-uuid-789',
      public_id: publicId,
      channel_id: 'channel-uuid-456',
      storage_key: `videos/${publicId}/original`,
      upload_id: 'minio-upload-id',
      status: VideoStatus.DRAFT,
    };
    const parts = [{ part_number: 1, etag: '"abc123etag"' }];

    it('completes S3 upload, transitions status to processing, and enqueues job', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(draftVideo);
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: userId,
      });
      storageService.completeMultipartUpload.mockResolvedValue(undefined);
      (videoRepo.update as jest.Mock).mockResolvedValue({ affected: 1 });
      (processingQueue.add as jest.Mock).mockResolvedValue({ id: 'job-1' });

      const result = await service.completeUpload(publicId, parts, userId);

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(result.id).toBe(draftVideo.id);
      expect(result.public_id).toBe(draftVideo.public_id);

      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        draftVideo.storage_key,
        draftVideo.upload_id,
        parts,
      );
      expect(videoRepo.update).toHaveBeenCalledWith(
        { id: draftVideo.id },
        { status: VideoStatus.PROCESSING, upload_id: null },
      );
      expect(processingQueue.add).toHaveBeenCalledWith('video.process', {
        videoId: draftVideo.id,
        storageKey: draftVideo.storage_key,
      });
    });

    it('throws VideoNotFoundException when video does not exist', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.completeUpload(publicId, parts, userId)).rejects.toThrow(
        VideoNotFoundException,
      );
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('throws NotChannelOwnerException when user does not own the channel', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue(draftVideo);
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: 'other-user-id',
      });

      await expect(service.completeUpload(publicId, parts, userId)).rejects.toThrow(
        NotChannelOwnerException,
      );
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('throws UploadNotInProgressException when status is not draft', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue({
        ...draftVideo,
        status: VideoStatus.PROCESSING,
      });
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: userId,
      });

      await expect(service.completeUpload(publicId, parts, userId)).rejects.toThrow(
        UploadNotInProgressException,
      );
    });

    it('throws UploadNotInProgressException when upload_id is null', async () => {
      (videoRepo.findOne as jest.Mock).mockResolvedValue({
        ...draftVideo,
        upload_id: null,
      });
      channelsService.findById.mockResolvedValue({
        id: draftVideo.channel_id,
        user_id: userId,
      });

      await expect(service.completeUpload(publicId, parts, userId)).rejects.toThrow(
        UploadNotInProgressException,
      );
    });
  });
});
