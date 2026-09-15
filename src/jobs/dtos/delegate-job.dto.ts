import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DelegateJobDto {
  @ApiProperty()
  targetBranchId: string;

  @ApiPropertyOptional()
  slaDaysTarget?: number;

  @ApiPropertyOptional()
  marginSplitAmPct?: number;

  @ApiPropertyOptional()
  marginSplitRecPct?: number;

  @ApiPropertyOptional()
  notes?: string;
}

export class AcceptDelegationDto {
  @ApiPropertyOptional()
  assignedPodId?: string;
}

export class RejectDelegationDto {
  @ApiPropertyOptional()
  notes?: string;
}
