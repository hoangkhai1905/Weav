import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceProxyService } from './workspace-proxy.service';

@Module({
  controllers: [WorkspaceController],
  providers: [WorkspaceProxyService],
})
export class WorkspaceModule {}
