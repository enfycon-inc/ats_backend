
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MarketSegmentsService } from './market-segments.service';
import { CreateMarketSegmentDto } from './dtos/create-market-segment.dto';
import { UpdateMarketSegmentDto } from './dtos/update-market-segment.dto';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

@Controller('api/market-segments')
@UseGuards(JwtAuthGuard)
export class MarketSegmentsController {
  constructor(private readonly marketSegmentsService: MarketSegmentsService) {}

  @Get()
  findAll() {
    return this.marketSegmentsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketSegmentsService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  create(@Body() dto: CreateMarketSegmentDto) {
    return this.marketSegmentsService.create(dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateMarketSegmentDto) {
    return this.marketSegmentsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.marketSegmentsService.remove(id);
  }
}
