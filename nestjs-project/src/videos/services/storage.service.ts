import { Inject, Injectable } from '@nestjs/common';
import {
  CreateMultipartUploadCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import s3Config from '../../config/s3.config';
import type { ConfigType } from '@nestjs/config';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(s3Config.KEY)
    private readonly config: ConfigType<typeof s3Config>,
  ) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
  }

  async initiateMultipartUpload(key: string): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const result = await this.client.send(command);
    if (!result.UploadId) {
      throw new Error('S3 did not return an UploadId');
    }
    return result.UploadId;
  }
}
