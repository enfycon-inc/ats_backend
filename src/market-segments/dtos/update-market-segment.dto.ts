import { PartialType } from '@nestjs/mapped-types';
import { CreateMarketSegmentDto } from './create-market-segment.dto';

export class UpdateMarketSegmentDto extends PartialType(CreateMarketSegmentDto) {}
