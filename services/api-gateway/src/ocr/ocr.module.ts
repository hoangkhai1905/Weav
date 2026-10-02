import { Module, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { OcrController } from './ocr.controller';
import { OcrService } from './ocr.service';

interface FastifyInstanceLike {
  hasContentTypeParser?(contentType: string): boolean;
  addContentTypeParser?(
    contentType: string,
    parser: (
      req: unknown,
      payload: unknown,
      done: (err: Error | null, res?: unknown) => void,
    ) => void,
  ): void;
}

@Module({
  imports: [ConfigModule],
  controllers: [OcrController],
  providers: [
    OcrService,
    {
      provide: 'FETCH_FN',
      useValue: globalThis.fetch,
    },
  ],
  exports: [OcrService],
})
export class OcrModule implements OnModuleInit {
  constructor(@Optional() private readonly adapterHost?: HttpAdapterHost) {}

  onModuleInit() {
    const adapter = this.adapterHost?.httpAdapter;
    if (!adapter) {
      return;
    }
    const instance = adapter.getInstance<FastifyInstanceLike>();
    if (
      instance &&
      typeof instance.addContentTypeParser === 'function' &&
      typeof instance.hasContentTypeParser === 'function' &&
      !instance.hasContentTypeParser('multipart/form-data')
    ) {
      instance.addContentTypeParser(
        'multipart/form-data',
        (
          _req: unknown,
          payload: unknown,
          done: (err: Error | null, res?: unknown) => void,
        ) => {
          done(null, payload);
        },
      );
    }
  }
}
