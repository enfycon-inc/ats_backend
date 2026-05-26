import { ApiProperty } from '@nestjs/swagger';

/**
 * RegisterTenantDto
 *
 * Used by the public POST /api/auth/register-tenant endpoint.
 * Creates a new Tenant + the first Admin user for that tenant.
 * The user is created with is_approved = false and must be approved
 * by the platform admin via the Approvals Panel.
 */
export class RegisterTenantDto {
  @ApiProperty({
    example: 'TechCorp Inc.',
    description: 'The company / organization name',
  })
  companyName: string;

  @ApiProperty({
    example: 'techcorp',
    description:
      'Unique subdomain slug for the company workspace (lowercase, alphanumeric, hyphens only). ' +
      'Will become: techcorp.enfycon.com',
  })
  subdomain: string;

  @ApiProperty({
    example: 'admin@techcorp.com',
    description: 'Email address for the first admin user of this tenant',
  })
  email: string;

  @ApiProperty({
    example: 'Jane Smith',
    description: 'Full name of the first admin user',
  })
  fullName: string;

  @ApiProperty({
    example: 'SecurePassword123',
    description: 'Password for the first admin user',
  })
  password: string;
}
