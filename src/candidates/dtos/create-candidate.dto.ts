import { ApiProperty } from '@nestjs/swagger';

export class CreateCandidateDto {
  @ApiProperty({ example: 'Manoj Duggi', description: 'The full name of the candidate' })
  fullName: string;

  @ApiProperty({ example: 'manojduggi@gmail.com', description: 'The candidate email address' })
  email: string;

  @ApiProperty({ example: '+1 (334) 555-4816', description: 'The candidate contact number' })
  phone: string;

  @ApiProperty({ example: 'Herndon, VA', description: 'The raw candidate location string' })
  location: string;

  @ApiProperty({ example: 6, description: 'Total years of experience' })
  experienceYears: number;

  @ApiProperty({ example: 'Email Security Engineer', description: 'The primary job title or role' })
  jobTitle: string;

  @ApiProperty({ example: 'Dice', description: 'The recruitment source channel' })
  source: string;

  @ApiProperty({ example: 'Have H1 Visa', description: 'The work authorization class' })
  workAuthorization: string;

  @ApiProperty({ example: ['Email Security', 'Proofpoint', 'Cybersecurity'], description: 'List of matching skill strings' })
  skills: string[];

  @ApiProperty({ example: 'Manoj Duggi\nEmail Security Specialist with 6 years experience...', description: 'Raw resume text' })
  rawText: string;
}
