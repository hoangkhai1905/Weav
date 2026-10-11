import { Module } from '@nestjs/common';
import { InvitationController } from './invitation.controller';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceProxyService } from './workspace-proxy.service';

@Module({
  controllers: [WorkspaceController, InvitationController],
  providers: [WorkspaceProxyService],
})
export class WorkspaceModule {}
