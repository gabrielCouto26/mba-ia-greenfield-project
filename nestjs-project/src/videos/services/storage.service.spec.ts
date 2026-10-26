import { Test } from '@nestjs/testing';
import s3Config from '../../config/s3.config';
import { StorageService } from './storage.service';
import { S3Client } from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(function (
      this: { config: unknown },
      cfg: unknown,
    ) {
      this.config = cfg;
    }),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url'),
}));

const MockedS3Client = S3Client as jest.MockedClass<typeof S3Client>;

function buildConfig(publicEndpoint?: string) {
  return {
    endpoint: 'http://minio:9000',
    publicEndpoint: publicEndpoint ?? 'http://minio:9000',
    region: 'us-east-1',
    bucket: 'streamtube',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
  };
}

async function createService(publicEndpoint?: string) {
  MockedS3Client.mockClear();
  const module = await Test.createTestingModule({
    providers: [
      StorageService,
      {
        provide: s3Config.KEY,
        useValue: buildConfig(publicEndpoint),
      },
    ],
  }).compile();
  return module.get(StorageService);
}

describe('StorageService', () => {
  describe('when S3_PUBLIC_ENDPOINT is set to a public host', () => {
    let internalEndpoint: string;
    let presignerEndpoint: string;

    beforeAll(async () => {
      await createService('http://localhost:9000');
      internalEndpoint = (
        MockedS3Client.mock.calls[0][0] as { endpoint: string }
      ).endpoint;
      presignerEndpoint = (
        MockedS3Client.mock.calls[1][0] as { endpoint: string }
      ).endpoint;
    });

    it('internal client is bound to the internal endpoint', () => {
      expect(internalEndpoint).toBe('http://minio:9000');
    });

    it('presigner client is bound to the public endpoint', () => {
      expect(presignerEndpoint).toBe('http://localhost:9000');
    });

    it('both clients use the same region and forcePathStyle:true', () => {
      const configs = MockedS3Client.mock.calls.map(
        (c) => c[0] as { region: string; forcePathStyle: boolean },
      );
      expect(configs[0].region).toBe(configs[1].region);
      expect(configs[0].forcePathStyle).toBe(true);
      expect(configs[1].forcePathStyle).toBe(true);
    });
  });

  describe('when S3_PUBLIC_ENDPOINT is unset (fallback)', () => {
    let internalEndpoint: string;
    let presignerEndpoint: string;

    beforeAll(async () => {
      // No publicEndpoint override → buildConfig defaults to the internal endpoint
      await createService();
      internalEndpoint = (
        MockedS3Client.mock.calls[0][0] as { endpoint: string }
      ).endpoint;
      presignerEndpoint = (
        MockedS3Client.mock.calls[1][0] as { endpoint: string }
      ).endpoint;
    });

    it('presigner client falls back to the internal endpoint', () => {
      expect(presignerEndpoint).toBe(internalEndpoint);
      expect(presignerEndpoint).toBe('http://minio:9000');
    });
  });
});
