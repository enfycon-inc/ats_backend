import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSubmissionDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'The UUID of the Job Requisition',
  })
  jobId: string;

  @ApiProperty({
    example: 42,
    description: 'The integer ID of the parsed Candidate profile',
  })
  candidateId: number;

  @ApiProperty({
    example: 'recruiter-uuid-or-name',
    description: 'The identifier of the submitting recruiter',
  })
  recruiterId: string;

  @ApiPropertyOptional({
    example: 'PENDING',
    enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
    description: 'Initial L1 interview status',
  })
  l1Status?: string;

  @ApiPropertyOptional({
    example: '2026-05-21T10:00:00.000Z',
    description: 'L1 interview schedule date',
  })
  l1Date?: string;

  @ApiPropertyOptional({
    example: 'PENDING',
    enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
    description: 'Initial L2 interview status',
  })
  l2Status?: string;

  @ApiPropertyOptional({
    example: '2026-05-22T10:00:00.000Z',
    description: 'L2 interview schedule date',
  })
  l2Date?: string;

  @ApiPropertyOptional({
    example: 'PENDING',
    enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
    description: 'Initial L3 interview status',
  })
  l3Status?: string;

  @ApiPropertyOptional({
    example: '2026-05-23T10:00:00.000Z',
    description: 'L3 interview schedule date',
  })
  l3Date?: string;

  @ApiPropertyOptional({
    example: 'SUBMITTED',
    enum: ['SUBMITTED', 'REJECTED', 'OFFER', 'JOIN'],
    description: 'Final status of candidate submission',
  })
  finalStatus?: string;

  @ApiPropertyOptional({
    example: 'Strong technical match with dbt experience.',
    description: 'General remarks or feedback about stages',
  })
  remarks?: string;

  @ApiPropertyOptional({
    example: 'Candidate is looking for 100% remote work.',
    description: 'Specific notes or comments added by the recruiter',
  })
  recruiterComment?: string;
}
