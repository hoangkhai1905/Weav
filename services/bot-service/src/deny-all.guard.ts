import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const Public = () => SetMetadata('public', true);

/** BOT-1: scaffold only. Every route is denied until real auth exists; `@Public()` opts a route out. */
@Injectable()
export class DenyAllGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    throw new ForbiddenException();
  }
}
