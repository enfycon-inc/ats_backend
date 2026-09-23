import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DelegateJobDto {
  @ApiPropertyOptional({ description: 'Target operating unit ID (same market domain enforced)' })
  targetUnitId?: string;

  @ApiPropertyOptional({ description: 'Target branch ID (legacy fallback)' })
  targetBranchId?: string;

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
