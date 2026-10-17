import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import s3Config from './s3.config';

const loadConfig = async (
  overrides: Record<string, string> = {},
): Promise<ConfigType<typeof s3Config>> => {
  Object.entries(overrides).forEach(([k, v]) => (process.env[k] = v));

  const module = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [s3Config] })],
  }).compile();

  const config = module.get<ConfigType<typeof s3Config>>(s3Config.KEY);
  await module.close();
  return config;
};

describe('s3Config', () => {
  afterEach(() => {
    [
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ].forEach((k) => delete process.env[k]);
  });

  it('should return default values when env vars are not set', async () => {
    const config = await loadConfig();
    expect(config.endpoint).toBe('http://minio:9000');
    expect(config.region).toBe('us-east-1');
    expect(config.bucket).toBe('streamtube');
  });

  it('should use provided env vars', async () => {
    const config = await loadConfig({
      S3_ENDPOINT: 'http://custom:9000',
      S3_REGION: 'eu-west-1',
      S3_BUCKET: 'my-bucket',
      S3_ACCESS_KEY_ID: 'my-key',
      S3_SECRET_ACCESS_KEY: 'my-secret',
    });
    expect(config.endpoint).toBe('http://custom:9000');
    expect(config.region).toBe('eu-west-1');
    expect(config.bucket).toBe('my-bucket');
    expect(config.accessKeyId).toBe('my-key');
    expect(config.secretAccessKey).toBe('my-secret');
  });
});
