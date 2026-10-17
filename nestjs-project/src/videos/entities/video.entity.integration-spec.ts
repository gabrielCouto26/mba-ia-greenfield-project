import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let channelRepo: Repository<Channel>;
  let videoRepo: Repository<Video>;

  let channelCounter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepo = dataSource.getRepository(User);
    channelRepo = dataSource.getRepository(Channel);
    videoRepo = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannelWithUser(): Promise<Channel> {
    const idx = ++channelCounter;
    const user = await userRepo.save(
      userRepo.create({
        email: `vid_user_${idx}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepo.save(
      channelRepo.create({
        name: `Channel ${idx}`,
        nickname: `channel${idx}`,
        user_id: user.id,
      }),
    );
  }

  function baseVideo(channelId: string): Partial<Video> {
    return {
      public_id: `testpubid${channelCounter}`.slice(0, 11),
      storage_key: `videos/test-${channelCounter}.mp4`,
      channel_id: channelId,
    };
  }

  it('should default status to draft and auto-generate id and timestamps', async () => {
    const channel = await createChannelWithUser();
    const video = await videoRepo.save(videoRepo.create(baseVideo(channel.id)));

    expect(video.id).toBeDefined();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.title).toBe('');
    expect(video.created_at).toBeInstanceOf(Date);
    expect(video.updated_at).toBeInstanceOf(Date);
  });

  it('should enforce unique public_id constraint', async () => {
    const channel = await createChannelWithUser();
    const publicId = 'UNIQUE00001';

    await videoRepo.save(
      videoRepo.create({ ...baseVideo(channel.id), public_id: publicId }),
    );

    await expect(
      videoRepo.save(
        videoRepo.create({ ...baseVideo(channel.id), public_id: publicId }),
      ),
    ).rejects.toThrow();
  });

  it('should enforce FK: channel_id must reference an existing channel', async () => {
    await expect(
      videoRepo.save(
        videoRepo.create({
          public_id: 'NOCHANN001',
          storage_key: 'videos/no-chan.mp4',
          channel_id: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should allow nullable fields to be null', async () => {
    const channel = await createChannelWithUser();
    const video = await videoRepo.save(videoRepo.create(baseVideo(channel.id)));

    expect(video.error_reason).toBeNull();
    expect(video.duration).toBeNull();
    expect(video.size_bytes).toBeNull();
    expect(video.mimetype).toBeNull();
    expect(video.original_filename).toBeNull();
    expect(video.thumbnail_key).toBeNull();
    expect(video.upload_id).toBeNull();
  });
});
