import { ApiProperty } from '@nestjs/swagger';

export class AcceptInviteDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Unique invitation token delivered via email',
  })
  token: string;

  @ApiProperty({
    example: 'SecurePassword2026!',
    description: 'New password chosen by the user',
  })
  password: string;
}
