import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
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
  findAll(@Req() req: any, @Headers('x-tenant-id') headerTenantId: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.marketSegmentsService.findAll(tenantId);
  }

  @Get(':id')
  findOne(
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId: string,
    @Param('id') id: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.marketSegmentsService.findOne(tenantId, id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('tenant:settings')
  create(
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId: string,
    @Body() dto: CreateMarketSegmentDto,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.marketSegmentsService.create(tenantId, dto);
  }

  @Put(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('tenant:settings')
  update(
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMarketSegmentDto,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.marketSegmentsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('tenant:settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId: string,
    @Param('id') id: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.marketSegmentsService.remove(tenantId, id);
  }
}
