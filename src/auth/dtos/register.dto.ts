import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'recruiter@enfycon.com', description: 'Registration email' })
  email: string;

  @ApiProperty({ example: 'SecurePassword123', description: 'User account password' })
  password?: string;

  @ApiProperty({ example: 'Enfy Recruiter', description: 'Full name' })
  fullName: string;

  @ApiProperty({ example: 'Recruiter', enum: ['Admin', 'Recruiter', 'Interviewer'], description: 'Client access role' })
  role: string;
}
