import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { EmailService } from './email.service';

function sanitizeReturnTo(url: string | null | undefined, frontendUrl: string): string {
  if (!url) return '/email';
  const trimmed = url.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const parsedFrontend = new URL(frontendUrl);
    if (parsed.origin === parsedFrontend.origin || parsed.hostname.endsWith('enfyjobs.com') || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return trimmed;
    }
  } catch (err) {
    // Fall back to safe relative path
  }
  return '/email';
}

@Controller('api/v1/auth')
export class EmailAuthController {
  private readonly logger = new Logger(EmailAuthController.name);

  constructor(private readonly emailService: EmailService) {}

  @Get('google')
  googleAuthInit(@Query('returnTo') returnTo: string, @Query('tenantId') tenantId: string, @Query('userId') userId: string, @Res() res: Response) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email');
    const defaultTenantId = process.env.DEFAULT_TENANT_ID ;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const safeReturnTo = sanitizeReturnTo(returnTo, frontendUrl);
    const stateObj = { returnTo: safeReturnTo, tenantId: tenantId || defaultTenantId, userId: userId || null };
    const state = encodeURIComponent(JSON.stringify(stateObj));
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    res.redirect(authUrl);
  }

  @Get('callback')
  async googleAuthCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    let rawReturnPath = '/email';
    let tenantId = process.env.DEFAULT_TENANT_ID ;
    let userId = null;
    try {
      const decoded = decodeURIComponent(state);
      if (decoded.startsWith('{')) {
        const stateObj = JSON.parse(decoded);
        rawReturnPath = stateObj.returnTo || '/email';
        tenantId = stateObj.tenantId || tenantId;
        userId = stateObj.userId || null;
      } else {
        rawReturnPath = decoded;
      }
    } catch (e) {
      rawReturnPath = state ? decodeURIComponent(state) : '/email';
    }
    const returnPath = sanitizeReturnTo(rawReturnPath, frontendUrl);
    const baseUrl = returnPath.startsWith('http') ? returnPath.split('?')[0] : `${frontendUrl}${returnPath.split('?')[0]}`;
    const fullUrl = returnPath.startsWith('http') ? returnPath : `${frontendUrl}${returnPath}`;
    
    if (!code) {
      return res.redirect(`${baseUrl}?error=no_code`);
    }
    
    try {
      await this.emailService.handleGoogleCallback(code, tenantId, userId);
      const joiner = fullUrl.includes('?') ? '&' : '?';
      res.redirect(`${fullUrl}${joiner}connected=success`);
    } catch (error) {
      this.logger.error('Google OAuth callback failed', error);
      const joiner = fullUrl.includes('?') ? '&' : '?';
      res.redirect(`${fullUrl}${joiner}error=oauth_failed`);
    }
  }

  @Get('microsoft')
  microsoftAuthInit(@Query('returnTo') returnTo: string, @Query('tenantId') tenantId: string, @Query('userId') userId: string, @Res() res: Response) {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const defaultApiUrl = process.env.BACKEND_PUBLIC_URL || process.env.API_BASE_URL || 'https://api.enfyjobs.com';
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${defaultApiUrl}/api/v1/auth/callback/microsoft`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const safeReturnTo = sanitizeReturnTo(returnTo, frontendUrl);
    
    if (!clientId) {
      this.logger.warn('MICROSOFT_CLIENT_ID is not configured in backend environment.');
      const fallback = safeReturnTo || '/company';
      const joiner = fallback.includes('?') ? '&' : '?';
      return res.redirect(`${fallback}${joiner}error=microsoft_client_id_missing`);
    }

    const scope = encodeURIComponent('offline_access Mail.Send User.Read');
    const defaultTenantId = process.env.DEFAULT_TENANT_ID ;
    const stateObj = { returnTo: safeReturnTo, tenantId: tenantId || defaultTenantId, userId: userId || null };
    const state = encodeURIComponent(JSON.stringify(stateObj));
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;
    res.redirect(authUrl);
  }

  @Get('callback/microsoft')
  async microsoftAuthCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    let rawReturnPath = '/email';
    let tenantId = process.env.DEFAULT_TENANT_ID ;
    let userId = null;
    try {
      const decoded = decodeURIComponent(state);
      if (decoded.startsWith('{')) {
        const stateObj = JSON.parse(decoded);
        rawReturnPath = stateObj.returnTo || '/email';
        tenantId = stateObj.tenantId || tenantId;
        userId = stateObj.userId || null;
      } else {
        rawReturnPath = decoded;
      }
    } catch (e) {
      rawReturnPath = state ? decodeURIComponent(state) : '/email';
    }
    const returnPath = sanitizeReturnTo(rawReturnPath, frontendUrl);
    const baseUrl = returnPath.startsWith('http') ? returnPath.split('?')[0] : `${frontendUrl}${returnPath.split('?')[0]}`;
    const fullUrl = returnPath.startsWith('http') ? returnPath : `${frontendUrl}${returnPath}`;
    
    if (!code) {
      return res.redirect(`${baseUrl}?error=no_code`);
    }
    
    try {
      await this.emailService.handleMicrosoftCallback(code, tenantId, userId);
      const joiner = fullUrl.includes('?') ? '&' : '?';
      const redirectUrl = `${fullUrl}${joiner}connected=success`;
      this.logger.log(`Redirecting to: ${JSON.stringify(redirectUrl)}`);
      res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error('Microsoft OAuth callback failed', error);
      const joiner = fullUrl.includes('?') ? '&' : '?';
      const redirectUrl = `${fullUrl}${joiner}error=oauth_failed`;
      res.redirect(redirectUrl);
    }
  }
}
