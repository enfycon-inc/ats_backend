import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddCustomDomainDto {
  @ApiProperty({
    example: 'ats.acmecorp.com',
    description: 'Custom domain or subdomain name to connect to workspace',
  })
  domainName: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Set as primary domain for workspace links',
    default: false,
  })
  isPrimary?: boolean;
}

export class VerifyCustomDomainDto {
  @ApiProperty({
    example: 'ats.acmecorp.com',
    description: 'Domain name to trigger DNS challenge verification for',
  })
  domainName: string;
}
