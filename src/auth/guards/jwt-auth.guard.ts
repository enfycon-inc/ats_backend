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
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * JwtAuthGuard — Keycloak JWT Authentication Guard
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  • Validates RS256 JWT tokens using Keycloak's JWKS public keys.
 *  • Automatically verifies RSA signature and expiration against cached public keys.
 *  • Persists JWKS keys to DB so verification survives backend restarts.
 *  • Syncs user profile with local PostgreSQL DB on demand.
 *  • Attaches full AuthUser context to request.user.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  // In-process JWKS public key cache  { kid → PEM string }
  private readonly jwksCache = new Map<string, string>();

  // In-process user cache { keycloakId → { user: any, expiresAt: number } } to eliminate repetitive DB sync calls
  private readonly userCache = new Map<string, { user: any; expiresAt: number }>();

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/enfycon-ats';
    this.logger.log(
      `[AUTH] KEYCLOAK mode active. JWKS: ${issuer}/protocol/openid-connect/certs`,
    );
    // Ensure kv_store table exists for JWKS key persistence
    this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ats.kv_store (
        key   VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    return this.validateToken(request);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Token verification (Supports Keycloak RS256 JWKS and Internal tokens)
  // ─────────────────────────────────────────────────────────────────────────
  private async validateToken(request: any): Promise<boolean> {
    const token = this.extractBearerToken(request);

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed token.');
    }

    const header = this.decodeBase64Json(parts[0]);

    if (header.kid) {
      // ── Keycloak RS256 token ──
      const publicKey = await this.getPublicKey(header.kid);
      const data = `${parts[0]}.${parts[1]}`;
      const signature = Buffer.from(parts[2], 'base64url');
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(data);
      if (!verify.verify(publicKey, signature)) {
        throw new UnauthorizedException('Authentication token signature invalid.');
      }

      const decoded = this.decodeBase64Json(parts[1]);
      this.checkExpiry(decoded.exp, 'Session');

      const IGNORED_KEYCLOAK_ROLES = new Set([
        'OFFLINE_ACCESS',
        'UMA_AUTHORIZATION',
        'MANAGE_ACCOUNT',
        'MANAGE_ACCOUNT_LINKS',
        'VIEW_PROFILE',
        'ACCOUNT',
        'ADMIN_CLI',
        'BROKER',
        'REALM_ADMIN',
        'CREATE_CLIENT',
        'MANAGE_USERS',
        'MANAGE_REALM',
        'MANAGE_EVENTS',
        'MANAGE_CLIENTS',
        'MANAGE_AUTHORIZATION',
        'VIEW_USERS',
        'VIEW_REALM',
        'VIEW_EVENTS',
        'VIEW_CLIENTS',
        'VIEW_AUTHORIZATION',
        'IMPERSONATION',
        'USER',
      ]);

      const isTechnicalKeycloakRole = (r: string) => {
        if (!r || typeof r !== 'string') return true;
        const upper = r.trim().toUpperCase().replace(/[-\s]/g, '_');
        if (upper.startsWith('DEFAULT_ROLES_') || upper.startsWith('DEFAULT_ROLES')) return true;
        return IGNORED_KEYCLOAK_ROLES.has(upper);
      };

      const realmRoles: string[] = (decoded.realm_access?.roles || []).filter((r: string) => !isTechnicalKeycloakRole(r));
      const clientRoles: string[] = [];
      if (decoded.resource_access) {
        Object.values(decoded.resource_access).forEach((client: any) => {
          if (client?.roles) {
            clientRoles.push(...client.roles.filter((r: string) => !isTechnicalKeycloakRole(r)));
          }
        });
      }
      const groupRoles: string[] = (decoded.groups || []).filter((r: string) => !isTechnicalKeycloakRole(r));
      const allJwtRoles = [...realmRoles, ...clientRoles, ...groupRoles];

      let dbUser: any;
      const cached = this.userCache.get(decoded.sub);
      if (cached && cached.expiresAt > Date.now()) {
        dbUser = cached.user;
      } else {
        dbUser = await this.authService.syncKeycloakUser({
          keycloakId: decoded.sub,
          email: decoded.email,
          fullName: decoded.name || decoded.preferred_username || decoded.email,
          roles: allJwtRoles,
        });
        this.userCache.set(decoded.sub, {
          user: dbUser,
          expiresAt: Date.now() + 60_000,
        });
      }

      if (!dbUser.is_active) {
        throw new UnauthorizedException(
          'Your account has been deactivated. Contact your administrator.',
        );
      }

      const mergedRoles = Array.from(
        new Set([...allJwtRoles, ...(dbUser.roles || [])]),
      )
        .map((r) => (r as string).toUpperCase().replace(/[\s-]/g, '_'))
        .filter((r) => !isTechnicalKeycloakRole(r));

      request.user = {
        dbId: dbUser.id,
        keycloakId: decoded.sub,
        email: decoded.email || dbUser.email,
        fullName: decoded.name || dbUser.full_name,
        roles: mergedRoles,
        tenantId: dbUser.tenant_id || DEFAULT_TENANT_ID,
        isActive: dbUser.is_active,
        permissions: dbUser.permissions || [],
        podId: dbUser.pod_id || null,
        branchId: dbUser.branch_id || null,
        assignedBranchIds: dbUser.assigned_branch_ids || [],
        branchRoles: dbUser.branch_roles || {},
        businessUnitId: dbUser.business_unit_id || null,
        defaultMarket: dbUser.default_market || 'US',
        tenantDomain: dbUser.tenant_domain || '',
        // SUPER_ADMIN is authoritative from Keycloak realm_access.roles
        systemRole: realmRoles.includes('SUPER_ADMIN')
          ? 'SUPER_ADMIN'
          : (dbUser.system_role || 'RECRUITER'),
      };

      return true;
    }

    // No kid header — reject. All tokens must be Keycloak RS256.
    throw new UnauthorizedException(
      'Token is not a valid Keycloak RS256 token. Internal tokens are no longer supported.',
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch RSA public key from Keycloak JWKS endpoint (with in-process + DB cache)
  // Falls back to DB-persisted key if Keycloak is temporarily unreachable.
  // ─────────────────────────────────────────────────────────────────────────
  private async getPublicKey(kid: string): Promise<string> {
    // 1. In-process memory cache (fastest)
    if (this.jwksCache.has(kid)) {
      return this.jwksCache.get(kid)!;
    }

    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/enfycon-ats';
    let jwksUrl = `${issuer}/protocol/openid-connect/certs`;

    let jwks: any;
    let keycloakReachable = false;

    try {
      jwks = await this.fetchJson(jwksUrl);
      keycloakReachable = true;
    } catch (err: any) {
      const fallbackUrl = jwksUrl.includes('localhost')
        ? jwksUrl.replace('localhost', 'keycloak')
        : jwksUrl.replace('keycloak', 'localhost');
      this.logger.warn(`[JwtAuthGuard] JWKS fetch to ${jwksUrl} failed. Trying fallback: ${fallbackUrl}`);
      try {
        jwks = await this.fetchJson(fallbackUrl);
        keycloakReachable = true;
      } catch (fallbackErr: any) {
        // Keycloak is unreachable — try DB-persisted key before failing
        this.logger.warn(`[JwtAuthGuard] JWKS fallback also failed. Checking DB cache for kid="${kid}"...`);
        try {
          const cached = await this.prisma.kvStore.findUnique({
            where: { key: `jwks_pem:${kid}` },
          });
          if (cached?.value) {
            const cachedPem = cached.value;
            this.jwksCache.set(kid, cachedPem);
            this.logger.log(`[JwtAuthGuard] Recovered public key for kid="${kid}" from DB cache.`);
            return cachedPem;
          }
        } catch (dbErr: any) {
          this.logger.error(`[JwtAuthGuard] DB cache lookup also failed: ${dbErr.message}`);
        }
        throw new UnauthorizedException(
          `Keycloak unavailable and no cached key found for kid="${kid}". Please try again shortly.`,
        );
      }
    }

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

    // Cache for the lifetime of this process instance and persist to DB cache
    this.jwksCache.set(kid, publicKey);
    this.prisma.kvStore.upsert({
      where: { key: `jwks_pem:${kid}` },
      update: { value: publicKey, updatedAt: new Date() },
      create: { key: `jwks_pem:${kid}`, value: publicKey },
    }).catch(() => {});
    this.logger.debug(`[Keycloak] Cached public key for kid="${kid}"`);

    return publicKey;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private extractBearerToken(request: any): string {
    const authHeader = (request.headers.authorization || request.headers.Authorization) as string | undefined;
    if (!authHeader) {
      throw new UnauthorizedException(
        'Authorization header missing. Use: Authorization: Bearer <token>',
      );
    }
    let token = authHeader.trim();
    // Strip one or more 'Bearer ' / 'bearer ' prefixes
    while (/^bearer\s+/i.test(token)) {
      token = token.replace(/^bearer\s+/i, '').trim();
    }
    // Strip surrounding quotes if present
    token = token.replace(/^["']|["']$/g, '').trim();

    if (!token) {
      throw new UnauthorizedException(
        'Authorization token missing. Use: Authorization: Bearer <token>',
      );
    }
    return token;
  }

  private decodeBase64Json(segment: string): any {
    try {
      return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Token payload could not be decoded.');
    }
  }

  private checkExpiry(exp: number | undefined, label: string): void {
    // 30-second grace period for clock skew only
    if (exp && Math.floor(Date.now() / 1000) > (exp + 30)) {
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
