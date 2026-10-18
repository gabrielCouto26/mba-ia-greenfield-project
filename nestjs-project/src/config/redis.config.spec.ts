import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import redisConfig from './redis.config';

const loadConfig = async (
  overrides: Record<string, string> = {},
): Promise<ConfigType<typeof redisConfig>> => {
  Object.entries(overrides).forEach(([k, v]) => (process.env[k] = v));

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [redisConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof redisConfig>>(redisConfig.KEY);
  await module.close();
  return config;
};

describe('redisConfig', () => {
  afterEach(() => {
    ['REDIS_HOST', 'REDIS_PORT'].forEach((k) => delete process.env[k]);
  });

  it('should return default values when env vars are not set', async () => {
    const config = await loadConfig();
    expect(config.host).toBe('redis');
    expect(config.port).toBe(6379);
  });

  it('should use provided env vars', async () => {
    const config = await loadConfig({
      REDIS_HOST: 'custom-redis',
      REDIS_PORT: '6380',
    });
    expect(config.host).toBe('custom-redis');
    expect(config.port).toBe(6380);
  });
});
