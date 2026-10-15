import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { DeliveryDashboardService } from './delivery-dashboard.service';

@Controller('api/business-units/current/dashboard')
@UseGuards(JwtAuthGuard)
export class DeliveryDashboardController {
  constructor(private readonly dashboardService: DeliveryDashboardService) {}

  @Get()
  dashboard(@CurrentUser() user: AuthUser, @Query('stage') stage?: string, @Query('page') page?: string, @Query('memberPage') memberPage?: string) {
    return this.dashboardService.dashboard(user, stage, page === undefined ? 1 : Number(page), memberPage === undefined ? 1 : Number(memberPage));
  }

  @Patch('members/:id')
  setMemberActive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body('isActive') isActive: unknown) {
    return this.dashboardService.setMemberActive(user, id, isActive);
  }
}
