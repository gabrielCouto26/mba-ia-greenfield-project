import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';

interface FfprobeOutput {
  format?: {
    duration?: string;
  };
}

function execFileAsync(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

@Injectable()
export class FfmpegService {
  async extractMetadata(filePath: string): Promise<number> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      filePath,
    ]);
    const data = JSON.parse(stdout) as FfprobeOutput;
    const duration = parseFloat(data.format?.duration ?? '0');
    if (isNaN(duration) || duration <= 0) {
      throw new Error(`Could not extract duration from: ${filePath}`);
    }
    return duration;
  }

  async generateThumbnail(
    inputPath: string,
    outputPath: string,
    timestamp = '00:00:01',
  ): Promise<void> {
    await execFileAsync('ffmpeg', [
      '-ss',
      timestamp,
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-y',
      outputPath,
    ]);
  }
}
