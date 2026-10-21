import { Module } from '@nestjs/common';
import { AdminWorkspaceController } from './admin-workspace.controller';
import { InvitationController } from './invitation.controller';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceProxyService } from './workspace-proxy.service';

@Module({
  controllers: [
    WorkspaceController,
    InvitationController,
    AdminWorkspaceController,
  ],
  providers: [WorkspaceProxyService],
})
export class WorkspaceModule {}
