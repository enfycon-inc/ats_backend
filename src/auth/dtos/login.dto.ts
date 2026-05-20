import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'recruiter@enfycon.com', description: 'User login email address' })
  email: string;

  @ApiProperty({ example: 'SecurePassword123', description: 'User security password' })
  password: string;
}
