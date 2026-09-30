const fs = require('fs');
let content = fs.readFileSync('src/market-segments/market-segments.service.ts', 'utf8');

// Remove tenantId from all methods
content = content.replace(/async findAll\(tenantId: string\) \{/g, "async findAll() {");
content = content.replace(/where: \{ tenantId \},/g, "");

content = content.replace(/async findOne\(tenantId: string, id: string\) \{/g, "async findOne(id: string) {");
content = content.replace(/where: \{ id, tenantId \},/g, "where: { id },");

content = content.replace(/async create\(tenantId: string, dto: CreateMarketSegmentDto\) \{/g, "async create(dto: CreateMarketSegmentDto) {");
content = content.replace(/where: \{ tenantId, code: dto\.code\.toUpperCase\(\) \},/g, "where: { code: dto.code.toUpperCase() },");
content = content.replace(/tenantId,/g, "");

content = content.replace(/async update\(tenantId: string, id: string, dto: UpdateMarketSegmentDto\) \{/g, "async update(id: string, dto: UpdateMarketSegmentDto) {");
content = content.replace(/await this\.findOne\(tenantId, id\);/g, "await this.findOne(id);");
content = content.replace(/where: \{ tenantId, code: dto\.code\.toUpperCase\(\), NOT: \{ id \} \},/g, "where: { code: dto.code.toUpperCase(), NOT: { id } },");

content = content.replace(/async remove\(tenantId: string, id: string\) \{/g, "async remove(id: string) {");
content = content.replace(/const segment = await this\.findOne\(tenantId, id\);/g, "const segment = await this.findOne(id);");

fs.writeFileSync('src/market-segments/market-segments.service.ts', content);
