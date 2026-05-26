import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RolesGuard — enforces role-based access control.
 *
 * MUST be applied AFTER JwtAuthGuard (which populates request.user).
 * Works identically in both mock and keycloak modes.
 *
 * Usage on controller method:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('ADMIN', 'RECRUITER')
 *   async createJob(...) {}
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator = endpoint is publicly accessible (after JWT check)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.roles) {
      throw new ForbiddenException(
        'Access denied. User has no roles assigned.',
      );
    }

    const normalizedRequired = requiredRoles.map((r) => r.toUpperCase());
    const normalizedUser = (user.roles as string[]).map((r) => r.toUpperCase());

    const hasRole = normalizedRequired.some((r) => normalizedUser.includes(r));

    this.logger.debug(
      `[RolesGuard] User: ${user.email} | Required: [${normalizedRequired.join(', ')}] | Has: [${normalizedUser.join(', ')}] | Access: ${hasRole}`,
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. This action requires one of: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
