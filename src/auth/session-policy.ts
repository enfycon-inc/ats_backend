import { UnauthorizedException } from '@nestjs/common';

export const ACCESS_TOKEN_SECONDS = 5 * 60;

export function assertNotRevoked(claims: { session_state?: string }, revoked: boolean) {
  if (revoked) {
    throw new UnauthorizedException('Your sessions were ended by an administrator. Please sign in again.');
  }
}
