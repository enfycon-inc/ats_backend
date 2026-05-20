import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { RegisterDto } from './dtos/register.dto';
import { LoginDto } from './dtos/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // In-memory registry to simulate user storage for authentication demo
  private readonly mockUsers = new Map<string, any>([
    [
      'recruiter@enfycon.com',
      {
        email: 'recruiter@enfycon.com',
        fullName: 'Enfy Recruiter',
        passwordHash: 'SecurePassword123', // Demo plaintext comparison
        role: 'Recruiter',
      },
    ],
  ]);

  /**
   * Registers a new user account profile in the database
   */
  async registerUser(dto: RegisterDto): Promise<any> {
    this.logger.log(`Registering account credentials for email: ${dto.email}`);
    
    if (this.mockUsers.has(dto.email)) {
      throw new UnauthorizedException(`The email address ${dto.email} is already registered.`);
    }

    const newUser = {
      email: dto.email,
      fullName: dto.fullName,
      passwordHash: dto.password || 'TemporaryPassword123',
      role: dto.role,
    };

    this.mockUsers.set(dto.email, newUser);
    return {
      email: newUser.email,
      fullName: newUser.fullName,
      role: newUser.role,
      message: 'Account registered successfully.',
    };
  }

  /**
   * Validates account credentials and returns access token values
   */
  async loginUser(dto: LoginDto): Promise<{ accessToken: string; user: any }> {
    this.logger.log(`Validating login session for user: ${dto.email}`);
    
    const user = this.mockUsers.get(dto.email);
    if (!user || user.passwordHash !== dto.password) {
      throw new UnauthorizedException('The email or password credentials provided are incorrect.');
    }

    // Generate simulated access tokens
    const accessToken = 'mock-super-token-123';
    
    return {
      accessToken,
      user: {
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }
}
