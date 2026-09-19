import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import { WorkspaceProxyService } from './workspace-proxy.service';

const workspaceIdSchema = z.string().uuid();
const roleSchema = z.enum(['OWNER', 'MEMBER']);
const directionSchema = z.enum(['asc', 'desc']);
const workspaceSortSchema = z.enum(['name', 'createdAt', 'updatedAt']);
const memberSortSchema = z.enum(['displayName', 'joinedAt', 'role']);
const integerQuery = (minimum: number, maximum?: number) => {
  const schema = z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(minimum));
  return maximum === undefined
    ? schema
    : schema.pipe(z.number().int().max(maximum));
};
const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const workspaceListQuerySchema = z
  .object({
    search: z.string().max(120).optional(),
    role: roleSchema.optional(),
    page: integerQuery(0).optional(),
    size: integerQuery(1, 100).optional(),
    sort: workspaceSortSchema.optional(),
    direction: directionSchema.optional(),
  })
  .strict();

const memberListQuerySchema = z
  .object({
    search: z.string().max(120).optional(),
    role: roleSchema.optional(),
    canPublishWorkflow: booleanQuery.optional(),
    canManageWorkflowState: booleanQuery.optional(),
    page: integerQuery(0).optional(),
    size: integerQuery(1, 100).optional(),
    sort: memberSortSchema.optional(),
    direction: directionSchema.optional(),
  })
  .strict();

const createWorkspaceBodySchema = z
  .object({
    name: z.union([z.string().min(1).max(255), z.null()]).optional(),
  })
  .strict();

const renameWorkspaceBodySchema = z
  .object({ name: z.string().min(1).max(255) })
  .strict();

const addMemberBodySchema = z
  .object({ email: z.string().min(1).max(320) })
  .strict();

const updatePermissionsBodySchema = z
  .object({
    canPublishWorkflow: z.boolean(),
    canManageWorkflowState: z.boolean(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException('Request validation failed');
  }
  return result.data;
}

function workspaceId(value: string): string {
  return parse(workspaceIdSchema, value);
}

@Controller('api/v1/workspaces')
@AuthPolicy('required')
export class WorkspaceController {
  constructor(private readonly proxy: WorkspaceProxyService) {}

  @Post()
  create(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.proxy.forward('POST', request, reply, '', {
      body: parse(createWorkspaceBodySchema, body),
    });
  }

  @Get()
  list(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    return this.proxy.forward('GET', request, reply, '', {
      query: parse(workspaceListQuerySchema, query),
    });
  }

  @Get(':workspaceId')
  get(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = workspaceId(rawWorkspaceId);
    return this.proxy.forward('GET', request, reply, `/${id}`);
  }

  @Patch(':workspaceId')
  rename(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const id = workspaceId(rawWorkspaceId);
    return this.proxy.forward('PATCH', request, reply, `/${id}`, {
      body: parse(renameWorkspaceBodySchema, body),
    });
  }

  @Get(':workspaceId/members')
  listMembers(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    const id = workspaceId(rawWorkspaceId);
    return this.proxy.forward('GET', request, reply, `/${id}/members`, {
      query: parse(memberListQuerySchema, query),
    });
  }

  @Post(':workspaceId/members')
  addMember(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const id = workspaceId(rawWorkspaceId);
    return this.proxy.forward('POST', request, reply, `/${id}/members`, {
      body: parse(addMemberBodySchema, body),
    });
  }

  @Patch(':workspaceId/members/:userId/permissions')
  updateMemberPermissions(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('userId') rawUserId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const workspace = workspaceId(rawWorkspaceId);
    const user = workspaceId(rawUserId);
    return this.proxy.forward(
      'PATCH',
      request,
      reply,
      `/${workspace}/members/${user}/permissions`,
      { body: parse(updatePermissionsBodySchema, body) },
    );
  }

  @Delete(':workspaceId/members/me')
  leave(
    @Param('workspaceId') rawWorkspaceId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = workspaceId(rawWorkspaceId);
    return this.proxy.forward('DELETE', request, reply, `/${id}/members/me`);
  }

  @Delete(':workspaceId/members/:userId')
  removeMember(
    @Param('workspaceId') rawWorkspaceId: string,
    @Param('userId') rawUserId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const workspace = workspaceId(rawWorkspaceId);
    const user = workspaceId(rawUserId);
    return this.proxy.forward(
      'DELETE',
      request,
      reply,
      `/${workspace}/members/${user}`,
    );
  }
}
