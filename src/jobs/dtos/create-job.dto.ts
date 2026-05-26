import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJobDto {
  // ─── Core Required Fields ───────────────────────────────────
  @ApiProperty({ example: 'Senior Java Developer (Spring Boot)', description: 'The official title of the job opening' })
  title: string;

  @ApiProperty({ example: 'Morph Enterprise', description: 'The hiring company or client name' })
  client: string;

  @ApiProperty({ example: 'Dallas', description: 'City location of the role' })
  location: string;

  @ApiProperty({ example: 'Contract', enum: ['Full-time', 'Contract', 'Part-time', 'C2C', 'W2'], description: 'Employment type' })
  type: string;

  @ApiProperty({ example: 'We are seeking a senior Java engineer...', description: 'Full HTML or plain text job description' })
  description: string;

  @ApiProperty({ example: ['Java', 'Spring Boot', 'Microservices'], description: 'Primary required skills' })
  skillsRequired: string[];

  // ─── Ceipal-Matching Fields (from frontend form) ─────────────
  @ApiPropertyOptional({ example: 'enfysync Inc', description: 'Business unit / division' })
  businessUnit?: string;

  @ApiPropertyOptional({ example: 'Texas', description: 'State / province' })
  state?: string;

  @ApiPropertyOptional({ example: 'United States', description: 'Country' })
  country?: string;

  @ApiPropertyOptional({ example: 'ME-9982', description: 'Client / VMS job reference number' })
  clientJobId?: string;

  @ApiPropertyOptional({ example: 'Active', enum: ['Active', 'Closed', 'Hold', 'Draft'], description: 'Current status of the job order' })
  status?: string;

  @ApiPropertyOptional({ example: 'US Citizen / GC', description: 'Visa eligibility requirement' })
  visaType?: string;

  @ApiPropertyOptional({ example: 'USD - $100/hr', description: 'Client bill rate' })
  clientBillRate?: string;

  @ApiPropertyOptional({ example: 'USD - $80/hr', description: 'Contractor pay rate' })
  payRate?: string;

  @ApiPropertyOptional({ example: 'End Client Corp', description: 'The end client name if different from direct client' })
  endClientName?: string;

  @ApiPropertyOptional({ example: 1, description: 'Number of open positions' })
  noOfPositions?: number;

  @ApiPropertyOptional({ example: 5, description: 'Number of submissions required' })
  submissionRequired?: number;

  @ApiPropertyOptional({ example: 'High', enum: ['High', 'Medium', 'Low'], description: 'Job priority level' })
  priority?: string;

  @ApiPropertyOptional({ example: 'C2C', enum: ['C2C', 'W2', '1099', 'Full-time'], description: 'Tax terms' })
  taxTerms?: string;

  @ApiPropertyOptional({ example: 'Hybrid', enum: ['Yes', 'No', 'Hybrid'], description: 'Remote work arrangement' })
  remoteJob?: string;

  @ApiPropertyOptional({ example: '2026-06-01', description: 'Job start date (YYYY-MM-DD)' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Job end date (YYYY-MM-DD)' })
  endDate?: string;

  @ApiPropertyOptional({ example: 40, description: 'Required hours per week' })
  hoursPerWeek?: number;

  @ApiPropertyOptional({ example: '6 months', description: 'Contract duration' })
  duration?: string;

  @ApiPropertyOptional({ example: 'recruiter-uuid-123', description: 'Account Manager user ID' })
  accountManagerId?: string;

  @ApiPropertyOptional({ example: 'recruiter-uuid-456', description: 'Recruitment Manager user ID' })
  recruitmentManagerId?: string;

  @ApiPropertyOptional({ example: 'recruiter-uuid-789', description: 'Primary Recruiter user ID' })
  primaryRecruiterId?: string;

  @ApiPropertyOptional({ example: 'Recruitment Team A', description: 'Assigned team or person name' })
  assignedTo?: string;

  @ApiPropertyOptional({ example: ['Docker', 'AWS', 'Git'], description: 'Secondary/nice-to-have skills' })
  secondarySkills?: string[];

  @ApiPropertyOptional({ example: 'IT', description: 'Industry domain' })
  industry?: string;

  @ApiPropertyOptional({ example: 'Bachelor', description: 'Minimum degree required' })
  degree?: string;

  @ApiPropertyOptional({ example: 3, description: 'Minimum years of experience' })
  expMin?: number;

  @ApiPropertyOptional({ example: 8, description: 'Maximum years of experience' })
  expMax?: number;
}
