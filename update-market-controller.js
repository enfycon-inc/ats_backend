const fs = require('fs');
let content = fs.readFileSync('src/market-segments/market-segments.controller.ts', 'utf8');

// Replace permissions with SUPER_ADMIN role
content = content.replace(/import \{ RequirePermissions \} from '\.\.\/auth\/decorators\/permissions\.decorator';/g, "import { Roles } from '../auth/decorators/roles.decorator';\nimport { RolesGuard } from '../auth/guards/roles.guard';");
content = content.replace(/import \{ PermissionsGuard \} from '\.\.\/auth\/guards\/permissions\.guard';/g, "");

content = content.replace(/@UseGuards\(PermissionsGuard\)\s+@RequirePermissions\('tenant:settings'\)/g, "@UseGuards(RolesGuard)\n  @Roles('SUPER_ADMIN')");

// Remove tenantId from service calls
content = content.replace(/findAll\(@Req\(\) req: any, @Headers\('x-tenant-id'\) headerTenantId: string\) \{[\s\S]*?return this\.marketSegmentsService\.findAll\(tenantId\);\s*\}/g, "findAll() {\n    return this.marketSegmentsService.findAll();\n  }");

content = content.replace(/findOne\([\s\S]*?@Param\('id'\) id: string,\s*\) \{[\s\S]*?return this\.marketSegmentsService\.findOne\(tenantId, id\);\s*\}/g, "findOne(@Param('id') id: string) {\n    return this.marketSegmentsService.findOne(id);\n  }");

content = content.replace(/create\([\s\S]*?@Body\(\) dto: CreateMarketSegmentDto,\s*\) \{[\s\S]*?return this\.marketSegmentsService\.create\(tenantId, dto\);\s*\}/g, "create(@Body() dto: CreateMarketSegmentDto) {\n    return this.marketSegmentsService.create(dto);\n  }");

content = content.replace(/update\([\s\S]*?@Param\('id'\) id: string,[\s\S]*?@Body\(\) dto: UpdateMarketSegmentDto,\s*\) \{[\s\S]*?return this\.marketSegmentsService\.update\(tenantId, id, dto\);\s*\}/g, "update(@Param('id') id: string, @Body() dto: UpdateMarketSegmentDto) {\n    return this.marketSegmentsService.update(id, dto);\n  }");

content = content.replace(/remove\([\s\S]*?@Param\('id'\) id: string,\s*\) \{[\s\S]*?return this\.marketSegmentsService\.remove\(tenantId, id\);\s*\}/g, "remove(@Param('id') id: string) {\n    return this.marketSegmentsService.remove(id);\n  }");

fs.writeFileSync('src/market-segments/market-segments.controller.ts', content);
