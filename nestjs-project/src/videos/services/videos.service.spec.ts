import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelsService } from '../../channels/channels.service';
import { NotChannelOwnerException } from '../../common/exceptions/domain.exception';
import { CreateVideoDto } from '../dto/create-video.dto';
import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from './storage.service';
import { VideosService } from './videos.service';

const mockVideoRepository = () => ({
  create: jest.fn(),
  save: jest.fn(),
});

const mockStorageService = () => ({
  initiateMultipartUpload: jest.fn(),
});

const mockChannelsService = () => ({
  findById: jest.fn(),
});

describe('VideosService', () => {
  let service: VideosService;
  let videoRepo: jest.Mocked<Pick<Repository<Video>, 'create' | 'save'>>;
  let storageService: jest.Mocked<{ initiateMultipartUpload: (key: string) => Promise<string> }>;
  let channelsService: jest.Mocked<{ findById: (id: string) => Promise<{ id: string; user_id: string } | null> }>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useFactory: mockVideoRepository },
        { provide: StorageService, useFactory: mockStorageService },
        { provide: ChannelsService, useFactory: mockChannelsService },
      ],
    }).compile();

    service = module.get(VideosService);
    videoRepo = module.get(getRepositoryToken(Video));
    storageService = module.get(StorageService);
    channelsService = module.get(ChannelsService);
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
});
