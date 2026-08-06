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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BusinessUnitsService } from './business-units.service';
import { CreateBusinessUnitDto } from './dtos/create-business-unit.dto';
import { UpdateBusinessUnitDto } from './dtos/update-business-unit.dto';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

@Controller('api/business-units')
@UseGuards(JwtAuthGuard)
export class BusinessUnitsController {
  constructor(private readonly buService: BusinessUnitsService) {}

  @Post()
  async create(
    @Body() dto: CreateBusinessUnitDto,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.create(dto, tenantId);
  }

  @Get()
  async findAll(@Req() req: any, @Headers('x-tenant-id') headerTenantId?: string) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.findAll(tenantId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.findOne(id, tenantId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessUnitDto,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.update(id, dto, tenantId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-tenant-id') headerTenantId?: string,
  ) {
    const tenantId = resolveTenantId(req.user, headerTenantId);
    return this.buService.remove(id, tenantId);
  }
}
