import { Test, TestingModule } from '@nestjs/testing';
import { execFile } from 'child_process';
import { FfmpegService } from './ffmpeg.service';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

describe('FfmpegService', () => {
  let service: FfmpegService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [FfmpegService],
    }).compile();

    service = module.get<FfmpegService>(FfmpegService);
  });

  describe('extractMetadata', () => {
    it('should return duration from ffprobe output', async () => {
      mockExecFile.mockImplementation((_cmd, _args, callback: any) => {
        callback(null, JSON.stringify({ format: { duration: '123.456' } }), '');
        return {} as any;
      });

      const duration = await service.extractMetadata('/tmp/video.mp4');

      expect(duration).toBeCloseTo(123.456);
      expect(mockExecFile).toHaveBeenCalledWith(
        'ffprobe',
        expect.arrayContaining(['/tmp/video.mp4']),
        expect.any(Function),
      );
    });

    it('should throw if duration cannot be parsed', async () => {
      mockExecFile.mockImplementation((_cmd, _args, callback: any) => {
        callback(null, JSON.stringify({ format: {} }), '');
        return {} as any;
      });

      await expect(service.extractMetadata('/tmp/bad.mp4')).rejects.toThrow(
        'Could not extract duration',
      );
    });
  });

  describe('generateThumbnail', () => {
    it('should call ffmpeg with correct arguments', async () => {
      mockExecFile.mockImplementation((_cmd, _args, callback: any) => {
        callback(null, '', '');
        return {} as any;
      });

      await service.generateThumbnail('/tmp/input.mp4', '/tmp/thumb.jpg', '00:00:05');

      expect(mockExecFile).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-ss', '00:00:05',
          '-i', '/tmp/input.mp4',
          '-frames:v', '1',
          '-y', '/tmp/thumb.jpg',
        ]),
        expect.any(Function),
      );
    });

    it('should use default timestamp when not provided', async () => {
      mockExecFile.mockImplementation((_cmd, _args, callback: any) => {
        callback(null, '', '');
        return {} as any;
      });

      await service.generateThumbnail('/tmp/input.mp4', '/tmp/thumb.jpg');

      expect(mockExecFile).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining(['-ss', '00:00:01']),
        expect.any(Function),
      );
    });
  });
});
