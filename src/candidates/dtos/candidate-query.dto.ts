import { ApiPropertyOptional } from '@nestjs/swagger';

export class CandidateQueryDto {
  @ApiPropertyOptional({ example: 'Dice', description: 'Filter candidates by source (e.g. Dice, Monster, Direct Upload)' })
  source?: string;

  @ApiPropertyOptional({ example: 'Email Security', description: 'Keyword query filtering candidate name, title, or skills' })
  q?: string;

  @ApiPropertyOptional({ example: 10, description: 'The number of records to return' })
  limit?: number;

  @ApiPropertyOptional({ example: 0, description: 'The offset index to start retrieving records' })
  offset?: number;
}
