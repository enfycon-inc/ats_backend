import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SsoLoginDto {
  @ApiProperty({
    example: 'google',
    description: 'OAuth SSO provider (google or microsoft)',
    enum: ['google', 'microsoft'],
  })
  provider: 'google' | 'microsoft';

  @ApiProperty({
    example: 'recruiter.sarah@gmail.com',
    description: 'Verified email returned by Google/Microsoft OAuth',
  })
  email: string;

  @ApiPropertyOptional({
    example: 'Sarah Jenkins',
    description: 'Full name returned by OAuth identity provider',
  })
  name?: string;

  @ApiPropertyOptional({
    example: 'deb',
    description: 'The tenant subdomain or custom domain context from which login was initiated',
  })
  subdomain?: string;

  @ApiPropertyOptional({
    example: '9188040d-6c67-4c5b-b112-36a304b66dad',
    description: 'Microsoft Azure Directory / Tenant ID (tid claim from Microsoft token)',
  })
  microsoftTenantId?: string;

  @ApiPropertyOptional({
    example: 'https://lh3.googleusercontent.com/a/sample',
    description: 'Profile picture avatar URL',
  })
  picture?: string;
}
