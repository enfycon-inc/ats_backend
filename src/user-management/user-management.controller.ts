import { Controller, Get, Post, Put, Param, Query, Req, Body, UseGuards, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserManagementService } from './user-management.service';
import { SessionTrackingService } from './session-tracking.service';
import { OfficeLocationService } from './office-location.service';

@Controller('api/user-management')
@UseGuards(JwtAuthGuard)
export class UserManagementController {
  constructor(private readonly users: UserManagementService, private readonly tracking: SessionTrackingService, private readonly office: OfficeLocationService) {}
  @Get('office-branches') officeBranches(@Req() req: any) { return this.office.branches(req.user); }
  @Get('office-network-candidates') officeCandidates(@Req() req: any) { return this.office.candidates(req.user); }
  @Get('branches/:id/office-policy') officePolicy(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.office.policy(req.user, id); }
  @Put('branches/:id/office-policy') saveOfficePolicy(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.office.save(req.user, id, body); }
  @Get('geofence-units') geofenceUnits(@Req() req: any) { return this.office.geofenceUnits(req.user); }
  @Get('business-units/:id/geofence') unitGeofence(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.office.unitGeofence(req.user, id); }
  @Put('business-units/:id/geofence') saveUnitGeofence(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.office.saveUnitGeofence(req.user, id, body); }
  @Get('me/office-context') officeContext(@Req() req: any) { return this.office.context(req.user); }
  @Post('me/location-challenge') locationChallenge(@Req() req: any) { return this.office.challenge(req.user); }
  @Post('me/location-checks') locationCheck(@Req() req: any, @Body() body: any) { return this.office.check(req.user, body); }
  @Get('users') list(@Req() req: any, @Query() query: Record<string, string>) { return this.users.list(req.user, query); }
  @Get('users/:id/sessions') sessions(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query('page') page?: string) {
    return this.users.sessions(req.user, id, this.page(page));
  }
  @Get('users/:id/events') events(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query('page') page?: string) {
    return this.users.events(req.user, id, this.page(page));
  }
  @Get('me/sessions') ownSessions(@Req() req: any, @Query('page') page?: string) { return this.users.sessions(req.user, req.user.dbId, this.page(page)); }
  @Get('users/:id/events/export') exportEvents(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.users.exportEvents(req.user, id, from, to);
  }
  @Post('me/logout') logout(@Req() req: any) {
    if (!this.tracking.enabled || !req.user.sessionMembershipId) return { success: true, localSessionRevoked: false };
    return this.users.revoke(req.user, req.user.sessionMembershipId).then(result => ({ ...result, localSessionRevoked: true }));
  }
  @Post('sessions/:id/revoke') revoke(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.users.revoke(req.user, id); }
  @Post('presence/heartbeat') heartbeat(@Req() req: any, @Body() body: { tabId?: string; active?: boolean }) {
    if (typeof body.tabId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.tabId) || typeof body.active !== 'boolean') throw new BadRequestException('Invalid presence update.');
    return this.tracking.heartbeat(req.user, body.tabId, body.active).then(() => ({ success: true }));
  }
  private page(raw?: string) {
    const page = raw === undefined ? 1 : Number(raw);
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new BadRequestException('Invalid page.');
    return page;
  }
}
