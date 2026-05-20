import { ApiProperty } from '@nestjs/swagger';

export class SourcingDownloadDto {
  @ApiProperty({
    description: 'The job board provider where the candidate was found',
    enum: ['dice', 'monster'],
    example: 'dice',
  })
  provider: 'dice' | 'monster';

  @ApiProperty({
    description: 'The unique external candidate or resume ID on the provider job board',
    example: 'DICE-88914',
  })
  externalId: string;
}
