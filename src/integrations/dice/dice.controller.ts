import { Controller, Get, Post, Body, Param, Headers, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DiceService, DiceSettings, DiceCandidateResult } from './dice.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../../auth/utils/tenant-resolver';

@ApiTags('Integrations — Dice.com')
@Controller('api/integrations/dice')
export class DiceController {
  constructor(private readonly diceService: DiceService) {}

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tenant Dice API integration settings & view quota' })
  async getSettings(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<DiceSettings> {
    const tid = resolveTenantId(user, tenantId);
    return this.diceService.getSettings(tid);
  }

  @Post('settings')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save or update tenant Dice API integration settings' })
  async saveSettings(
    @Body() dto: { clientId?: string; clientSecret?: string; accountId?: string; isActive?: boolean; dailyViewLimit?: number },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<DiceSettings> {
    const tid = resolveTenantId(user, tenantId);
    return this.diceService.saveSettings(tid, dto);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search Dice candidate resume database (Live or Sandbox Mode)' })
  async search(
    @Body() query: { q?: string; location?: string; skills?: string[]; workAuth?: string; limit?: number },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<{ results: DiceCandidateResult[]; mode: 'LIVE' | 'SANDBOX'; totalFound: number }> {
    const tid = resolveTenantId(user, tenantId);
    return this.diceService.searchCandidates(tid, query);
  }

  @Post('import/:id')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Import a Dice candidate profile into the candidate pool' })
  async importCandidate(
    @Param('id') diceId: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<any> {
    const tid = resolveTenantId(user, tenantId);
    return this.diceService.importCandidate(tid, diceId, user);
  }
}
