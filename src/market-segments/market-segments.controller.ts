
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MarketSegmentsService } from './market-segments.service';
import { CreateMarketSegmentDto } from './dtos/create-market-segment.dto';
import { UpdateMarketSegmentDto } from './dtos/update-market-segment.dto';

@Controller('api/market-segments')
@UseGuards(JwtAuthGuard)
export class MarketSegmentsController {
  constructor(private readonly marketSegmentsService: MarketSegmentsService) {}

  @Get()
  findAll(@Req() req: any) {
    const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    return this.marketSegmentsService.findAll(
      permissions.includes('platform:manage') || permissions.includes('*'),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketSegmentsService.findOne(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('platform:manage')
  create(@Body() dto: CreateMarketSegmentDto) {
    return this.marketSegmentsService.create(dto);
  }

  @Put(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('platform:manage')
  update(@Param('id') id: string, @Body() dto: UpdateMarketSegmentDto) {
    return this.marketSegmentsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('platform:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.marketSegmentsService.remove(id);
  }
}
