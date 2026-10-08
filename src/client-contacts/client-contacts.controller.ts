import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClientContactsService } from './client-contacts.service';
import { CreateClientContactDto } from './dtos/create-client-contact.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Client Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller(['clients/:clientId/contacts', 'api/clients/:clientId/contacts'])
export class ClientContactsController {
  constructor(private readonly service: ClientContactsService) {}

  @ApiOperation({ summary: 'List all contacts for a client (mine first, then others)' })
  @Get()
  list(@Param('clientId') clientId: string, @Req() req: any) {
    return this.service.findAllForClient(clientId, req.user.tenantId, req.user.dbId, req.user);
  }

  @ApiOperation({ summary: 'Create a new contact for a client' })
  @Post()
  create(@Param('clientId') clientId: string, @Body() dto: CreateClientContactDto, @Req() req: any) {
    return this.service.create(clientId, req.user.tenantId, req.user.dbId, dto);
  }

  @ApiOperation({ summary: 'Update a contact (only creator or admin)' })
  @Patch(':id')
  update(@Param('clientId') clientId: string, @Param('id') id: string, @Body() dto: Partial<CreateClientContactDto>, @Req() req: any) {
    return this.service.update(id, req.user.tenantId, req.user.dbId, dto, req.user.permissions);
  }

  @ApiOperation({ summary: 'Delete a contact (only creator or admin)' })
  @Delete(':id')
  remove(@Param('clientId') clientId: string, @Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user.tenantId, req.user.dbId, req.user.permissions);
  }
}
