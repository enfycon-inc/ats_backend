import { ApiProperty } from '@nestjs/swagger';

export class BulkUserImportRowDto {
  @ApiProperty({ example: 'Priya' })
  firstName: string;

  @ApiProperty({ example: 'Sharma' })
  lastName: string;

  @ApiProperty({ example: 'Priya Sharma', required: false, deprecated: true })
  fullName?: string;

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

  @ApiProperty({ example: 'YES', required: false, description: 'Example rows marked YES are ignored by the importer.' })
  example?: string;
}

export class BulkUserImportDto {
  @ApiProperty({ type: [BulkUserImportRowDto], maxItems: 100 })
  rows: BulkUserImportRowDto[];
}
