import { Controller, Post, Get, Body, UseGuards, Request, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dtos/register.dto';
import { LoginDto } from './dtos/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('ATS Security & Authorization')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register New User Credentials',
    description: 'Registers recruiter or admin credentials for logging into the ATS.',
  })
  @ApiResponse({ status: 201, description: 'User profile registered successfully.' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.registerUser(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate User & Issue Access Token',
    description: 'Validates signin email/password, issues a mock JWT, and returns user identity scopes.',
  })
  @ApiResponse({ status: 200, description: 'Authenticated successfully. Session token generated.' })
  @ApiResponse({ status: 401, description: 'Authentication credentials rejected.' })
  async login(@Body() dto: LoginDto) {
    return this.authService.loginUser(dto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Retrieve Current Session Identity Scope',
    description: 'Intercepts authorization headers and displays credentials attached to the request session by JWT shields.',
  })
  @ApiResponse({ status: 200, description: 'Successfully resolved token claims.' })
  @ApiResponse({ status: 401, description: 'Invalid or missing bearer credentials.' })
  async getProfile(@Request() req: any) {
    return req.user;
  }
}
