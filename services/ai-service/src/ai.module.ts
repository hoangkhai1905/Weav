import { DynamicModule, Module } from '@nestjs/common';
import { AiDeps, AI_DEPS } from './ai-deps';
import { Admission } from './infrastructure/admission';
import { AiController } from './presentation/http/ai.controller';
import { AssistantController } from './presentation/http/assistant.controller';
import { HealthController } from './presentation/http/health.controller';

@Module({})
export class AiModule {
  static register(deps: AiDeps): DynamicModule {
    return {
      module: AiModule,
      // Flag off: the assistant route is not registered, so it answers like any unknown route.
      controllers: [
        AiController,
        HealthController,
        ...(deps.config.AI_ASSISTANT_ENABLED ? [AssistantController] : []),
      ],
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
