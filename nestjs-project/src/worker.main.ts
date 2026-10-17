import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

bootstrap().catch((err) => {
  console.error('Worker failed to start', err);
  process.exit(1);
});
