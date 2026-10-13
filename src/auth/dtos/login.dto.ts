import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'recruiter@enfycon.com',
    description: 'User login email address',
  })
  email: string;

  @ApiProperty({
    example: 'SecurePassword123',
    description: 'User password',
  })
  password: string;

  @ApiProperty({
    example: 'tenant1',
    description: 'The tenant subdomain or custom domain context from which the login is requested',
    required: false,
  })
  subdomain?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Request a seven-day offline session when explicitly enabled by the user',
  })
  rememberMe?: boolean;
}
