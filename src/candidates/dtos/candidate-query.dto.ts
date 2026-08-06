import { ApiPropertyOptional } from '@nestjs/swagger';

export class CandidateQueryDto {
  @ApiPropertyOptional({ example: 'Dice', description: 'Filter candidates by source (e.g. Dice, Monster, Direct Upload)' })
  source?: string;

  @ApiPropertyOptional({ example: 'Email Security', description: 'Keyword query filtering candidate name, title, or skills' })
  q?: string;

  @ApiPropertyOptional({ example: 'US', description: 'Filter candidates by market segment (US vs INDIA)' })
  market?: string;

  @ApiPropertyOptional({ example: 'd3b07384-d113-49c3-a555-9ee75c13ca33', description: 'Filter candidates by branch ID' })
  branchId?: string;

  @ApiPropertyOptional({ example: false, description: 'Override market filtering if user has CANDIDATES_SEARCH_ALL_MARKETS permission' })
  allMarkets?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'The number of records to return' })
  limit?: number;

  @ApiPropertyOptional({ example: 0, description: 'The offset index to start retrieving records' })
  offset?: number;
}
