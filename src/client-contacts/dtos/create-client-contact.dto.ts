import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClientContactDto {
  @ApiProperty({ example: 'Suresh Kumar', description: 'Full name of the contact' })
  name: string;

  @ApiPropertyOptional({ example: 'HR Head', description: 'Designation / title at the client' })
  designation?: string;

  @ApiPropertyOptional({ example: 'suresh@wipro.com' })
  email?: string;

  @ApiPropertyOptional({ example: '+91-9876543210' })
  phone?: string;

  @ApiPropertyOptional({ example: 'https://linkedin.com/in/sureshkumar' })
  linkedinUrl?: string;

  @ApiPropertyOptional({ example: true, description: 'Mark as primary contact for this client' })
  isPrimary?: boolean;

  @ApiPropertyOptional({ example: 'Only for Java roles in Bangalore' })
  notes?: string;
}
