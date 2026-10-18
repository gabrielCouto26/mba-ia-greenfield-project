import { registerAs } from '@nestjs/config';

export default registerAs('s3', () => ({
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  region: process.env.S3_REGION || 'us-east-1',
  bucket: process.env.S3_BUCKET || 'streamtube',
  accessKeyId: process.env.S3_ACCESS_KEY_ID || 'streamtube',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'streamtube123',
}));
