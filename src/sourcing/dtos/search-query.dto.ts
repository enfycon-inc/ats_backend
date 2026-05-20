import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SourcingSearchQueryDto {
  @ApiProperty({
    description: 'The job board provider to query candidates from',
    enum: ['dice', 'monster'],
    example: 'dice',
  })
  provider: 'dice' | 'monster';

  @ApiProperty({
    description: 'The search query string containing skills, job titles, or keywords',
    example: 'React Developer, Node.js, AWS',
  })
  q: string;

  @ApiPropertyOptional({
    description: 'Filter candidates by geographical location (City, State or ZIP Code)',
    example: 'Atlanta, GA',
  })
  location?: string;

  @ApiPropertyOptional({
    description: 'Filter by work authorization type',
    example: 'US Citizen',
    enum: ['US Citizen', 'Have H1 Visa', 'Employment Auth. Document', 'Any'],
  })
  workAuthorization?: string;
}
