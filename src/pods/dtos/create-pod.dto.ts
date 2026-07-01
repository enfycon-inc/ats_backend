import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePodDto {
  @ApiProperty({ example: 'Alpha Recruitment Pod', description: 'Name of the recruitment team pod' })
  name: string;

  @ApiPropertyOptional({ example: 'd3b07384-d113-49c3-a555-9ee75c13ca33', description: 'User ID of the designated Pod Head' })
  podHeadId?: string;

  @ApiPropertyOptional({ example: ['d3b07384-d113-49c3-a555-9ee75c13ca33'], description: 'List of recruiter User IDs assigned to this pod' })
  recruiterIds?: string[];

  @ApiPropertyOptional({ example: 'Optional team description', description: 'Description of the recruitment team focus' })
  description?: string;
}
