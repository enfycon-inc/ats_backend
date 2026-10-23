import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClientContactDto {
  @ApiPropertyOptional({ example: 'Suresh Kumar', description: 'Legacy full name; new forms submit firstName and lastName' })
  name?: string;

  @ApiPropertyOptional({ description: "Contact first name" })
  firstName?: string;

  @ApiPropertyOptional({ description: "Contact last name" })
  lastName?: string;

  @ApiPropertyOptional({ description: "Custom title when designation is Other" })
  otherDesignation?: string;

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
