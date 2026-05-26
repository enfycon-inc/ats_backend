import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorator to restrict an endpoint to specific roles.
 * Works with RolesGuard (applied AFTER JwtAuthGuard).
 *
 * Usage:
 *   @Roles('ADMIN', 'RECRUITER')
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
