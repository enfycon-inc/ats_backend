import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Parameter decorator to inject the resolved AuthUser directly into a controller method.
 *
 * Usage:
 *   async getProfile(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);
