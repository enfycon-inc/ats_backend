import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

/**
 * PermissionsGuard — enforces granular permission-based access control.
 *
 * MUST be applied AFTER JwtAuthGuard (which populates request.user).
 * Bypasses checks for global SUPER_ADMIN accounts.
 *
 * Usage on controller method:
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   @RequirePermissions('job:create')
 *   async createJob(...) {}
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequirePermissions() decorator = endpoint is accessible to any authenticated user
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('Access denied. No authenticated user found.');
    }

    // Platform SUPER_ADMIN bypasses all normal tenant permission checks
    if (user.roles && user.roles.includes('SUPER_ADMIN')) {
      this.logger.debug(`[PermissionsGuard] User: ${user.email} is SUPER_ADMIN. Bypassing check.`);
      return true;
    }

    const userPermissions = (user.permissions as string[]) || [];

    const hasPermission = requiredPermissions.every((perm) => userPermissions.includes(perm));

    this.logger.debug(
      `[PermissionsGuard] User: ${user.email} | Required: [${requiredPermissions.join(', ')}] | Has: [${userPermissions.join(', ')}] | Access: ${hasPermission}`,
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `Access denied. You do not have the required permissions: [${requiredPermissions.join(', ')}]`,
      );
    }

    return true;
  }
}
