import { Controller, Post, Body, Get, Param, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

@ApiTags('Mass Email & Campaigns')
@Controller('email')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('campaigns')
  async createCampaign(
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.createCampaign(dto, tid, user.dbId);
  }

  @Post('campaigns/:id/cancel')
  async cancelCampaign(@Param('id') id: string) {
    return this.emailService.cancelCampaign(id);
  }

  @Get('campaigns')
  async getCampaigns(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.getCampaigns(tid, user);
  }

  @Get('campaigns/active')
  async getActiveCampaign() {
    return this.emailService.getActiveCampaign();
  }

  @Get('templates')
  async getTemplates(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.getTemplates(tid);
  }

  @Get('accounts')
  async getAccounts(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.getConnectedAccounts(tid, user);
  }

  @Post('accounts/custom')
  async addCustomAccount(
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.addCustomAccount(dto, tid, user.dbId);
  }

  @Post('accounts/:id/delete')
  async deleteAccount(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.deleteAccount(id, tid, user);
  }

  @Post('accounts/:id/share')
  async shareAccount(
    @Param('id') id: string,
    @Body() dto: { sharedWithAll: boolean; sharedWithUsers: string[]; sharedWithBranches: string[] },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.shareAccount(id, tid, user, dto);
  }

  @Post('accounts/:id/default')
  async setDefaultAccount(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.setDefaultAccount(id, tid);
  }

  @Get('preferences')
  async getPreferences(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.getPreferences(tid);
  }

  @Post('preferences')
  async savePreference(
    @Body() dto: { actionName: string; accountId: string },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.savePreference(dto.actionName, dto.accountId, tid);
  }

  @Get('campaigns/:id/status')
  async getCampaignStatus(@Param('id') id: string) {
    return this.emailService.getCampaignStatus(id);
  }

  @Get('campaigns/:id/recipients')
  async getCampaignRecipients(@Param('id') id: string) {
    return this.emailService.getCampaignRecipients(id);
  }

  @Get('delivery-settings')
  async getDeliverySettings(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.getDeliverySettings(tid, branchId || user.branchId);
  }

  @Get('tenant-settings')
  async getTenantEmailSettings(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.getTenantEmailSettings(tid);
  }

  @Post('tenant-settings/mode')
  async setTenantEmailMode(
    @Body() dto: { mode: string },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.setTenantEmailMode(tid, dto.mode);
  }

  @Post('tenant-settings/custom-domain')
  async setTenantCustomDomain(
    @Body() dto: { customDomain: string },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.setTenantCustomDomain(tid, dto.customDomain);
  }

  @Post('tenant-settings/verify-domain')
  async verifyTenantCustomDomain(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.emailService.verifyTenantCustomDomain(tid);
  }

  @Post('tenant-settings/test-email')
  async sendTestTenantEmail(
    @Body() dto: { recipientEmail?: string },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const targetEmail = dto.recipientEmail || user.email;
    return this.emailService.sendTenantEmail({
      tenantId: tid,
      to: targetEmail,
      subject: `EnfySync ATS — Test Email Configuration Verification`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h3 style="color: #4f46e5; margin-top: 0;">✅ Email Strategy Verified</h3>
          <p style="color: #334155; font-size: 14px;">
            This test email confirms that your workspace email dispatch strategy is configured and working properly!
          </p>
          <p style="color: #64748b; font-size: 12px; margin-top: 20px;">
            Sent by EnfySync ATS Multi-Tenant Delivery Engine.
          </p>
        </div>
      `,
    });
  }
}
