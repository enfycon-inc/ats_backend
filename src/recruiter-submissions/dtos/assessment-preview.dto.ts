import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssessmentPreviewDto {
  @ApiProperty() jobId!: string;
  @ApiPropertyOptional() candidateId?: string;
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiPropertyOptional() totalExperienceYears?: number;
  @ApiPropertyOptional() currentLocation?: string;
  @ApiProperty({ enum: ['SPECIFIC_LOCATIONS', 'REMOTE_ONLY', 'REMOTE_OR_LOCATIONS'] }) preferredLocationMode!: string;
  @ApiPropertyOptional({ type: [String] }) preferredLocations?: string[];
  @ApiPropertyOptional() noticePeriodDays?: number;
}
