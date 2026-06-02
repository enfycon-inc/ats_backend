import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { EmailService } from './email.service';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('campaigns')
  async createCampaign(@Body() dto: any) {
    return this.emailService.createCampaign(dto);
  }

  @Post('campaigns/:id/cancel')
  async cancelCampaign(@Param('id') id: string) {
    return this.emailService.cancelCampaign(id);
  }

  @Get('campaigns')
  async getCampaigns() {
    return this.emailService.getCampaigns();
  }

  @Get('campaigns/active')
  async getActiveCampaign() {
    return this.emailService.getActiveCampaign();
  }

  @Get('templates')
  async getTemplates() {
    return this.emailService.getTemplates();
  }

  @Get('accounts')
  async getAccounts() {
    return this.emailService.getConnectedAccounts();
  }

  @Post('accounts/custom')
  async addCustomAccount(@Body() dto: any) {
    return this.emailService.addCustomAccount(dto);
  }

  @Post('accounts/:id/delete')
  async deleteAccount(@Param('id') id: string) {
    return this.emailService.deleteAccount(id);
  }

  @Post('accounts/:id/default')
  async setDefaultAccount(@Param('id') id: string) {
    return this.emailService.setDefaultAccount(id);
  }

  @Get('preferences')
  async getPreferences() {
    return this.emailService.getPreferences();
  }

  @Post('preferences')
  async savePreference(@Body() dto: { actionName: string, accountId: string }) {
    return this.emailService.savePreference(dto.actionName, dto.accountId);
  }

  @Get('campaigns/:id/status')
  async getCampaignStatus(@Param('id') id: string) {
    return this.emailService.getCampaignStatus(id);
  }

  @Get('campaigns/:id/recipients')
  async getCampaignRecipients(@Param('id') id: string) {
    return this.emailService.getCampaignRecipients(id);
  }
}
