import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthPolicy } from '../auth/auth-policy.decorator';
import { requireAdmin } from '../identity/identity.module';
import { WorkspaceProxyService } from './workspace-proxy.service';

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

// Comma-separated UUIDs (at most 100), forwarded as the same string.
const idsQuery = z
  .string()
  .max(100 * 37)
  .refine((value) => {
    const parts = value.split(',');
    return (
      parts.length <= 100 &&
      parts.every((part) => z.string().uuid().safeParse(part).success)
    );
  });

const adminWorkspaceQuerySchema = z
  .object({
    page: integerQuery(0).optional(),
    size: integerQuery(1, 100).optional(),
    q: z.string().max(100).optional(),
    ownerId: z.string().uuid().optional(),
    ids: idsQuery.optional(),
  })
  .strict();

/** Cross-workspace listing for system administrators. */
@Controller('api/admin/workspaces')
@AuthPolicy('required')
export class AdminWorkspaceController {
  constructor(private readonly proxy: WorkspaceProxyService) {}

  @Get()
  list(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: unknown,
  ) {
    requireAdmin(request);
    const parsed = adminWorkspaceQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('Request validation failed');
    }
    return this.proxy.forward('GET', request, reply, '/admin/workspaces', {
      rootPath: '',
      query: parsed.data,
    });
  }
}
