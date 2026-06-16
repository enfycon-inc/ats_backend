import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type UserRole =
  | 'RECRUITER'
  | 'ACCOUNT_MANAGER'
  | 'DELIVERY_HEAD'
  | 'ADMIN'
  | 'TRACKER';

export class RegisterDto {
  @ApiProperty({
    example: 'john.doe@enfycon.com',
    description: 'User email address — must be unique',
  })
  email: string;

  @ApiProperty({ example: 'John Doe', description: 'Full display name' })
  fullName: string;

  @ApiProperty({
    example: 'SecurePassword123',
    description: 'Login password (stored as bcrypt hash)',
  })
  password: string;

  @ApiProperty({
    example: 'RECRUITER',
    description: 'ATS role to assign',
    enum: ['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'ADMIN', 'TRACKER'],
  })
  role: UserRole;

  @ApiPropertyOptional({
    example: 'd3b07384-d113-49c3-a555-9ee75c13ca33',
    description:
      'Tenant UUID. Defaults to the primary Enfy tenant when omitted.',
  })
  tenantId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Auto-approve user (for direct tenant admin registration)',
  })
  isApproved?: boolean;
}
