import {
  DynamicModule,
  Inject,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { AI_DEPS } from './ai-deps';
import type { AiDeps } from './ai-deps';
import { Admission } from './infrastructure/admission';
import { AiController } from './presentation/http/ai.controller';
import { AssistantHistoryController } from './presentation/http/assistant-history.controller';
import { AssistantController } from './presentation/http/assistant.controller';
import { HealthController } from './presentation/http/health.controller';

@Module({})
export class AiModule implements OnApplicationShutdown {
  constructor(@Inject(AI_DEPS) private readonly deps: AiDeps) {}

  async onApplicationShutdown() {
    await this.deps.assistant?.onShutdown?.();
  }

  static register(deps: AiDeps): DynamicModule {
    return {
      module: AiModule,
      // Flag off: the assistant route is not registered, so it answers like any unknown route.
      controllers: [
        AiController,
        HealthController,
        ...(deps.config.AI_ASSISTANT_ENABLED
          ? [AssistantController, AssistantHistoryController]
          : []),
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
