import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import { WorkspaceProxyService } from './workspace-proxy.service';

const idSchema = z.string().uuid();

function invitationId(value: string): string {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException('Request validation failed');
  }
  return result.data;
}

/**
 * W7-A1 invitee routes. The proxy prefixes /workspaces, so these forward to workspace-service's literal
 * /workspaces/invitations paths.
 */
@Controller('api/v1/invitations')
@AuthPolicy('required')
export class InvitationController {
  constructor(private readonly proxy: WorkspaceProxyService) {}

  @Get()
  list(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forward('GET', request, reply, '/invitations');
  }

  @Post(':invitationId/accept')
  accept(
    @Param('invitationId') rawInvitationId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = invitationId(rawInvitationId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/invitations/${id}/accept`,
    );
  }

  @Post(':invitationId/decline')
  decline(
    @Param('invitationId') rawInvitationId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = invitationId(rawInvitationId);
    return this.proxy.forward(
      'POST',
      request,
      reply,
      `/invitations/${id}/decline`,
    );
  }
}
