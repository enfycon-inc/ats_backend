import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type UserRole =
  | 'RECRUITER'
  | 'ACCOUNT_MANAGER'
  | 'DELIVERY_HEAD'
  | 'TENANT_ADMIN';

export class RegisterDto {
  @ApiProperty({
    example: 'john.doe@enfycon.com',
    description: 'User email address — must be unique',
  })
  email: string;

  @ApiPropertyOptional({ example: 'John', description: 'First name' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'Last name' })
  lastName?: string;

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
    enum: ['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'TENANT_ADMIN'],
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

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to dispatch welcome email with credentials and login guide',
  })
  sendEmailInvite?: boolean;

  @ApiPropertyOptional({ description: 'Primary branch office UUID' })
  branchId?: string;

  @ApiPropertyOptional({ description: 'Operating unit UUID' })
  businessUnitId?: string;




  @ApiPropertyOptional({ description: 'Multiple roles to assign' })
  roles?: string[];
}
