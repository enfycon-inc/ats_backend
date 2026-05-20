import { ApiProperty } from '@nestjs/swagger';

export class CreateJobDto {
  @ApiProperty({ example: 'Snowflake Data Engineer', description: 'The official title of the job opening' })
  title: string;

  @ApiProperty({ example: 'Deloitte', description: 'The hiring company or client name' })
  client: string;

  @ApiProperty({ example: 'Atlanta, GA', description: 'The official geographical location of the role' })
  location: string;

  @ApiProperty({ example: 'Full-time', enum: ['Full-time', 'Contract', 'Part-time'], description: 'Employment class' })
  type: string;

  @ApiProperty({ example: 'We are seeking a senior Snowflake engineer to architect pipelines...', description: 'Full job description text' })
  description: string;

  @ApiProperty({ example: ['Snowflake', 'dbt', 'SQL', 'Python'], description: 'List of mandatory skill qualifications' })
  skillsRequired: string[];

  @ApiProperty({ example: 'Active', enum: ['Active', 'Closed', 'Draft'], description: 'Current status of the job order' })
  status: string;
}
