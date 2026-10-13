import { ApiProperty } from '@nestjs/swagger';

export class BulkUserImportRowDto {
  @ApiProperty({ example: 'Priya Sharma' })
  fullName: string;

  @ApiProperty({ example: 'priya@example.com' })
  email: string;

  @ApiProperty({ example: 'Pune' })
  branch: string;

  @ApiProperty({ example: 'Technology Staffing' })
  unit: string;

  @ApiProperty({ example: 'Recruiter; Delivery Head' })
  roles: string;

  @ApiProperty({ example: 'PUNE', required: false })
  city?: string;
}

export class BulkUserImportDto {
  @ApiProperty({ type: [BulkUserImportRowDto], maxItems: 100 })
  rows: BulkUserImportRowDto[];
}
