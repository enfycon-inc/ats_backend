import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { DeliveryDashboardService } from './delivery-dashboard.service';
import { AccountManagerDashboardService } from './account-manager-dashboard.service';
import type { ManagerDashboardFilters } from './delivery-dashboard.contract';
import type { ManagerDetailFilters } from './delivery-dashboard.contract';
import { AccountManagerDetailService } from './account-manager-detail.service';
import { RecruiterPerformanceService } from './recruiter-performance.service';
import type { RecruiterFilters, RecruiterDetailFilters } from './delivery-dashboard.contract';

@Controller('api/business-units/current/dashboard')
@UseGuards(JwtAuthGuard)
export class DeliveryDashboardController {
  constructor(private readonly dashboardService: DeliveryDashboardService, private readonly managers: AccountManagerDashboardService, private readonly managerDetail: AccountManagerDetailService, private readonly recruiters: RecruiterPerformanceService) {}

  @Get('recruiters/:id')
  recruiterDetail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: Record<string, string>) {
    return this.recruiters.detail(user, id, { from: query.from, to: query.to, tab: query.tab as RecruiterDetailFilters['tab'], page: query.page === undefined ? 1 : Number(query.page),
      search: query.search, assignment: query.assignment as RecruiterDetailFilters['assignment'], status: query.status, clientId: query.clientId, attention: query.attention as RecruiterDetailFilters['attention'] });
  }

  @Get('recruiters')
  recruiterComparison(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.recruiters.dashboard(user, { search: query.search, recruiterId: query.recruiterId, podId: query.podId, from: query.from, to: query.to,
      sort: query.sort as RecruiterFilters['sort'], direction: query.direction as RecruiterFilters['direction'], offset: query.offset === undefined ? 0 : Number(query.offset), limit: query.limit === undefined ? 10 : Number(query.limit), snapshot: query.snapshot });
  }

  @Get('account-managers/:id')
  accountManagerDetail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: Record<string, string>) {
    return this.managerDetail.detail(user, id, { from: query.from, to: query.to, clientId: query.clientId, employmentType: query.employmentType,
      jobSearch: query.jobSearch, jobStatus: query.jobStatus, jobPage: query.jobPage === undefined ? 1 : Number(query.jobPage),
      clientPage: query.clientPage === undefined ? 1 : Number(query.clientPage), clientMode: query.clientMode as ManagerDetailFilters['clientMode'], attention: query.attention as ManagerDetailFilters['attention'] });
  }

  @Get('account-managers')
  accountManagers(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.managers.dashboard(user, { search: query.search, clientId: query.clientId, market: query.market,
      employmentType: query.employmentType, accountManagerId: query.accountManagerId, from: query.from, to: query.to,
      sort: query.sort as ManagerDashboardFilters['sort'], direction: query.direction as ManagerDashboardFilters['direction'],
      offset: query.offset === undefined ? 0 : Number(query.offset), limit: query.limit === undefined ? 10 : Number(query.limit), snapshot: query.snapshot });
  }

  @Get()
  dashboard(@CurrentUser() user: AuthUser, @Query('stage') stage?: string, @Query('page') page?: string, @Query('memberPage') memberPage?: string) {
    return this.dashboardService.dashboard(user, stage, page === undefined ? 1 : Number(page), memberPage === undefined ? 1 : Number(memberPage));
  }

  @Patch('members/:id')
  setMemberActive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body('isActive') isActive: unknown) {
    return this.dashboardService.setMemberActive(user, id, isActive);
  }
}
