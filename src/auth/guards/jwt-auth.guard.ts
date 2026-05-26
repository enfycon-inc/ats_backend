import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { AuthService } from '../auth.service';

const DEFAULT_TENANT_ID = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * JwtAuthGuard  —  Switchable Authentication Guard
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Controlled entirely by the AUTH_PROVIDER environment variable:
 *
 *  AUTH_PROVIDER=mock      → Development / staging mode.
 *    • POST /api/auth/login validates email+password against DB users table.
 *    • Returns a signed HS256 JWT containing the user's full claims.
 *    • Guard verifies that signature using MOCK_JWT_SECRET from .env.
 *    • Frontend behaviour is IDENTICAL to production — just uses a mock token.
 *
 *  AUTH_PROVIDER=keycloak  → Production mode.
 *    • Guard rejects all mock tokens.
 *    • Decodes the Keycloak JWT header to get the key ID (kid).
 *    • Fetches the matching RSA public key from the Keycloak JWKS endpoint
 *      (cached in-process after first fetch for performance).
 *    • Verifies the RSA-SHA256 signature using Node built-in crypto.
 *    • Syncs the user record to the local `users` table on-demand.
 *    • Attaches a fully-normalized AuthUser to the request.
 *
 * ZERO external dependencies — uses only Node.js built-ins (crypto, https).
 *
 * Switch in .env:
 *   AUTH_PROVIDER=mock        (default when not set)
 *   AUTH_PROVIDER=keycloak
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly provider: string;
  private readonly mockSecret: string;

  // In-process JWKS public key cache  { kid → PEM string }
  private readonly jwksCache = new Map<string, string>();

  constructor(private readonly authService: AuthService) {
    this.provider = (process.env.AUTH_PROVIDER || 'mock').toLowerCase();
    this.mockSecret =
      process.env.MOCK_JWT_SECRET ||
      'enfy-ats-dev-jwt-secret-change-me-in-prod';

    if (this.provider === 'keycloak') {
      if (!process.env.KEYCLOAK_ISSUER) {
        throw new Error(
          '[JwtAuthGuard] AUTH_PROVIDER=keycloak but KEYCLOAK_ISSUER is not set in .env',
        );
      }
      this.logger.log(
        `[AUTH] KEYCLOAK mode. JWKS: ${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`,
      );
    } else {
      this.logger.log(
        '[AUTH] MOCK mode. POST /api/auth/login to obtain a dev token.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    return this.provider === 'keycloak'
      ? this.validateKeycloakToken(request)
      : this.validateMockToken(request);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOCK MODE — verify HS256 JWT signed by AuthService.login()
  // ─────────────────────────────────────────────────────────────────────────
  private async validateMockToken(request: any): Promise<boolean> {
    const token = this.extractBearerToken(request);

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed token.');
    }

    // 1. Verify HS256 signature
    const data = `${parts[0]}.${parts[1]}`;
    const expectedSig = crypto
      .createHmac('sha256', this.mockSecret)
      .update(data)
      .digest('base64url');

    if (expectedSig !== parts[2]) {
      throw new UnauthorizedException(
        'Token signature invalid. Please log in again.',
      );
    }

    // 2. Decode and validate payload
    const decoded = this.decodeBase64Json(parts[1]);
    this.checkExpiry(decoded.exp, 'Session token');

    // 3. Attach AuthUser
    request.user = {
      dbId: decoded.sub,
      keycloakId: `MOCK-${decoded.sub}`,
      email: decoded.email,
      fullName: decoded.fullName,
      roles: decoded.roles || [],
      tenantId: decoded.tenantId || DEFAULT_TENANT_ID,
      isActive: true,
    };

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // KEYCLOAK MODE — verify RS256 JWT using JWKS public key
  // ─────────────────────────────────────────────────────────────────────────
  private async validateKeycloakToken(request: any): Promise<boolean> {
    const token = this.extractBearerToken(request);

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed Keycloak token.');
    }

    // 1. Decode header to get kid
    const header = this.decodeBase64Json(parts[0]);
    if (!header.kid) {
      throw new UnauthorizedException('Keycloak token missing key ID (kid).');
    }

    // 2. Fetch public key (from cache or JWKS endpoint)
    const publicKey = await this.getPublicKey(header.kid);

    // 3. Verify RSA-SHA256 signature
    const data = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2], 'base64url');
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(data);
    if (!verify.verify(publicKey, signature)) {
      throw new UnauthorizedException('Keycloak token signature invalid.');
    }

    // 4. Decode payload and check expiry
    const decoded = this.decodeBase64Json(parts[1]);
    this.checkExpiry(decoded.exp, 'Keycloak token');

    // 5. Extract roles from Keycloak JWT structure
    const realmRoles: string[] = decoded.realm_access?.roles || [];
    const clientRoles: string[] = [];
    if (decoded.resource_access) {
      Object.values(decoded.resource_access).forEach((client: any) => {
        if (client?.roles) clientRoles.push(...client.roles);
      });
    }
    const groupRoles: string[] = decoded.groups || [];
    const allJwtRoles = [...realmRoles, ...clientRoles, ...groupRoles];

    // 6. On-demand sync to local `users` table
    const dbUser = await this.authService.syncKeycloakUser({
      keycloakId: decoded.sub,
      email: decoded.email,
      fullName: decoded.name || decoded.preferred_username || decoded.email,
      roles: allJwtRoles,
    });

    if (!dbUser.is_active) {
      throw new UnauthorizedException(
        'Your account has been deactivated. Contact your administrator.',
      );
    }

    // 7. Merge DB roles (internal) + JWT roles and normalize
    const mergedRoles = Array.from(
      new Set([...allJwtRoles, ...(dbUser.roles || [])]),
    ).map((r) => (r as string).toUpperCase().replace(/[\s-]/g, '_'));

    // 8. Attach AuthUser
    request.user = {
      dbId: dbUser.id,
      keycloakId: decoded.sub,
      email: decoded.email || dbUser.email,
      fullName: decoded.name || dbUser.full_name,
      roles: mergedRoles,
      tenantId: dbUser.tenant_id || DEFAULT_TENANT_ID,
      isActive: dbUser.is_active,
    };

    this.logger.debug(
      `[Keycloak] ✓ ${request.user.email} | Roles: [${mergedRoles.join(', ')}]`,
    );

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch RSA public key from Keycloak JWKS endpoint (with in-process cache)
  // ─────────────────────────────────────────────────────────────────────────
  private async getPublicKey(kid: string): Promise<string> {
    if (this.jwksCache.has(kid)) {
      return this.jwksCache.get(kid)!;
    }

    const issuer = process.env.KEYCLOAK_ISSUER!;
    const jwksUrl = `${issuer}/protocol/openid-connect/certs`;

    const jwks = await this.fetchJson(jwksUrl);

    if (!jwks.keys || !Array.isArray(jwks.keys)) {
      throw new UnauthorizedException('Could not fetch JWKS from Keycloak.');
    }

    const key = jwks.keys.find((k: any) => k.kid === kid);
    if (!key) {
      throw new UnauthorizedException(
        `No matching public key found for kid="${kid}" in Keycloak JWKS.`,
      );
    }

    // Convert JWK to PEM using Node built-in crypto
    const publicKey = crypto
      .createPublicKey({ key, format: 'jwk' })
      .export({ type: 'spki', format: 'pem' }) as string;

    // Cache for the lifetime of this process instance
    this.jwksCache.set(kid, publicKey);
    this.logger.debug(`[Keycloak] Cached public key for kid="${kid}"`);

    return publicKey;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private extractBearerToken(request: any): string {
    const authHeader = request.headers.authorization as string | undefined;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Authorization header missing. Use: Authorization: Bearer <token>',
      );
    }
    return authHeader.slice(7).trim();
  }

  private decodeBase64Json(segment: string): any {
    try {
      return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Token payload could not be decoded.');
    }
  }

  private checkExpiry(exp: number | undefined, label: string): void {
    if (exp && Math.floor(Date.now() / 1000) > exp) {
      throw new UnauthorizedException(`${label} has expired. Please log in again.`);
    }
  }

  /** Minimal zero-dependency HTTP/HTTPS JSON fetch */
  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client
        .get(url, (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              reject(new Error(`Failed to parse JWKS response: ${e}`));
            }
          });
        })
        .on('error', reject);
    });
  }
}
