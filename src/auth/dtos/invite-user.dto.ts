import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InviteUserDto {
  @ApiProperty({
    example: 'recruiter.sarah@gmail.com',
    description: 'User email address to invite (corporate or personal)',
  })
  email: string;

  @ApiProperty({
    example: 'Sarah Jenkins',
    description: 'Full name of the user',
  })
  fullName: string;

  @ApiPropertyOptional({
    example: 'd3b07384-d113-49c3-a555-9ee75c13ca33',
    description: 'Optional custom role ID',
  })
  roleId?: string;

  @ApiPropertyOptional({
    example: 'RECRUITER',
    description: 'System role type (e.g. RECRUITER, ADMIN, ACCOUNT_MANAGER)',
    default: 'RECRUITER',
  })
  systemRole?: string;

  @ApiPropertyOptional({
    example: 'd3b07384-d113-49c3-a555-9ee75c13ca33',
    description: 'Optional branch ID assignment',
  })
  branchId?: string;

  @ApiPropertyOptional({
    example: 'd3b07384-d113-49c3-a555-9ee75c13ca33',
    description: 'Optional pod ID assignment',
  })
  podId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to dispatch a branded welcome email with login/setup links',
    default: true,
  })
  sendEmailInvite?: boolean;
}
