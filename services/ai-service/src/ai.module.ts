import { DynamicModule, Module } from '@nestjs/common';
import { AiDeps, AI_DEPS } from './ai-deps';
import { Admission } from './infrastructure/admission';
import { AiController } from './presentation/http/ai.controller';
import { HealthController } from './presentation/http/health.controller';

@Module({})
export class AiModule {
  static register(deps: AiDeps): DynamicModule {
    return {
      module: AiModule,
      controllers: [AiController, HealthController],
      providers: [
        { provide: AI_DEPS, useValue: deps },
        {
          provide: Admission,
          useValue: new Admission(
            deps.config.AI_MAX_CONCURRENCY,
            deps.config.AI_MAX_CONCURRENCY_PER_WORKSPACE,
          ),
        },
      ],
    };
  }
}
