import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { EmailService } from './email.service';

@Controller('api/v1/auth')
export class EmailAuthController {
  private readonly logger = new Logger(EmailAuthController.name);

  constructor(private readonly emailService: EmailService) {}

  @Get('google')
  googleAuthInit(@Query('returnTo') returnTo: string, @Query('tenantId') tenantId: string, @Query('userId') userId: string, @Res() res: Response) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email');
    const defaultTenantId = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';
    const stateObj = { returnTo: returnTo || '/email', tenantId: tenantId || defaultTenantId, userId: userId || null };
    const state = encodeURIComponent(JSON.stringify(stateObj));
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    res.redirect(authUrl);
  }

  @Get('callback')
  async googleAuthCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    let returnPath = '/email';
    let tenantId = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';
    let userId = null;
    try {
      const decoded = decodeURIComponent(state);
      if (decoded.startsWith('{')) {
        const stateObj = JSON.parse(decoded);
        returnPath = stateObj.returnTo || '/email';
        tenantId = stateObj.tenantId || tenantId;
        userId = stateObj.userId || null;
      } else {
        returnPath = decoded;
      }
    } catch (e) {
      returnPath = state ? decodeURIComponent(state) : '/email';
    }
    const baseUrl = returnPath.startsWith('http') ? returnPath.split('?')[0] : `http://localhost:3000${returnPath.split('?')[0]}`;
    const fullUrl = returnPath.startsWith('http') ? returnPath : `http://localhost:3000${returnPath}`;
    
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
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
    const scope = encodeURIComponent('offline_access Mail.Send User.Read');
    const defaultTenantId = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';
    const stateObj = { returnTo: returnTo || '/email', tenantId: tenantId || defaultTenantId, userId: userId || null };
    const state = encodeURIComponent(JSON.stringify(stateObj));
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
    res.redirect(authUrl);
  }

  @Get('callback/microsoft')
  async microsoftAuthCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    let returnPath = '/email';
    let tenantId = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';
    let userId = null;
    try {
      const decoded = decodeURIComponent(state);
      if (decoded.startsWith('{')) {
        const stateObj = JSON.parse(decoded);
        returnPath = stateObj.returnTo || '/email';
        tenantId = stateObj.tenantId || tenantId;
        userId = stateObj.userId || null;
      } else {
        returnPath = decoded;
      }
    } catch (e) {
      returnPath = state ? decodeURIComponent(state) : '/email';
    }
    const baseUrl = returnPath.startsWith('http') ? returnPath.split('?')[0] : `http://localhost:3000${returnPath.split('?')[0]}`;
    const fullUrl = returnPath.startsWith('http') ? returnPath : `http://localhost:3000${returnPath}`;
    
    if (!code) {
      return res.redirect(`${baseUrl}?error=no_code`);
    }
    
    try {
      await this.emailService.handleMicrosoftCallback(code, tenantId, userId);
      const joiner = fullUrl.includes('?') ? '&' : '?';
      const redirectUrl = `${fullUrl}${joiner}connected=success`;
      console.log('Redirecting to (success):', JSON.stringify(redirectUrl));
      res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error('Microsoft OAuth callback failed', error);
      const joiner = fullUrl.includes('?') ? '&' : '?';
      const redirectUrl = `${fullUrl}${joiner}error=oauth_failed`;
      console.log('Redirecting to (error):', JSON.stringify(redirectUrl));
      res.redirect(redirectUrl);
    }
  }
}
