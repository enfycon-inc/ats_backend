import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { EmailService } from './email.service';

@Controller('api/v1/auth')
export class EmailAuthController {
  private readonly logger = new Logger(EmailAuthController.name);

  constructor(private readonly emailService: EmailService) {}

  @Get('google')
  googleAuthInit(@Query('returnTo') returnTo: string, @Res() res: Response) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email');
    const state = returnTo ? encodeURIComponent(returnTo) : encodeURIComponent('/email');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    res.redirect(authUrl);
  }

  @Get('callback')
  async googleAuthCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const returnPath = state ? decodeURIComponent(state) : '/email';
    if (!code) {
      return res.redirect(`http://localhost:3000${returnPath.split('?')[0]}?error=no_code`);
    }
    
    try {
      await this.emailService.handleGoogleCallback(code);
      const joiner = returnPath.includes('?') ? '&' : '?';
      res.redirect(`http://localhost:3000${returnPath}${joiner}connected=success`);
    } catch (error) {
      this.logger.error('Google OAuth callback failed', error);
      const joiner = returnPath.includes('?') ? '&' : '?';
      res.redirect(`http://localhost:3000${returnPath}${joiner}error=oauth_failed`);
    }
  }

  @Get('microsoft')
  microsoftAuthInit(@Query('returnTo') returnTo: string, @Res() res: Response) {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
    const scope = encodeURIComponent('offline_access Mail.Send User.Read');
    const state = returnTo ? encodeURIComponent(returnTo) : encodeURIComponent('/email');
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
    res.redirect(authUrl);
  }

  @Get('callback/microsoft')
  async microsoftAuthCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const returnPath = state ? decodeURIComponent(state) : '/email';
    if (!code) {
      return res.redirect(`http://localhost:3000${returnPath.split('?')[0]}?error=no_code`);
    }
    
    try {
      await this.emailService.handleMicrosoftCallback(code);
      const joiner = returnPath.includes('?') ? '&' : '?';
      res.redirect(`http://localhost:3000${returnPath}${joiner}connected=success`);
    } catch (error) {
      this.logger.error('Microsoft OAuth callback failed', error);
      const joiner = returnPath.includes('?') ? '&' : '?';
      res.redirect(`http://localhost:3000${returnPath}${joiner}error=oauth_failed`);
    }
  }
}
