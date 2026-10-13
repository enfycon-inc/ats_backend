import { Module, Global } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { SystemMailModule } from '../email/system-mail.module';
import { EventsModule } from '../events/events.module';

// Sub-services
import { AuthQueryService } from './services/auth-query.service';
import { AuthCoreService } from './services/auth-core.service';
import { AuthUserService } from './services/auth-user.service';
import { AuthTenantService } from './services/auth-tenant.service';
import { AuthRbacService } from './services/auth-rbac.service';
import { AuthKeycloakService } from './services/auth-keycloak.service';
import { AuthInviteService } from './services/auth-invite.service';
import { AuthEmailService } from './services/auth-email.service';
import { AuthInitService } from './services/auth-init.service';
import { AuthPasswordService } from './services/auth-password.service';
import { StaffProfileService } from './services/staff-profile.service';
import { StaffProfileController } from './staff-profile.controller';

const AUTH_SUB_SERVICES = [
  AuthQueryService,
  AuthEmailService,
  AuthKeycloakService,
  AuthRbacService,
  AuthTenantService,
  AuthUserService,
  AuthCoreService,
  AuthInviteService,
  AuthPasswordService,
  AuthInitService,
  StaffProfileService,
];

@Global()
@Module({
  imports: [EventsModule, SystemMailModule],
  controllers: [AuthController, StaffProfileController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, ...AUTH_SUB_SERVICES],
  exports: [AuthService, JwtAuthGuard, RolesGuard, ...AUTH_SUB_SERVICES],
})
export class AuthModule {}
