const fs = require('fs');

let dto = fs.readFileSync('src/market-segments/dtos/create-market-segment.dto.ts', 'utf8');
dto = dto.replace(/defaultTimezone\?: string;\n/, '');
dto = dto.replace(/defaultShift\?: string;\n/, '');
dto = dto.replace(/defaultStartTime\?: string;\n/, '');
dto = dto.replace(/defaultEndTime\?: string;\n/, '');
fs.writeFileSync('src/market-segments/dtos/create-market-segment.dto.ts', dto);

let srv = fs.readFileSync('src/market-segments/market-segments.service.ts', 'utf8');
srv = srv.replace(/defaultTimezone: true,\n/, '');
srv = srv.replace(/defaultShift: true,\n/, '');
srv = srv.replace(/defaultStartTime: true,\n/, '');
srv = srv.replace(/defaultEndTime: true,\n/, '');

srv = srv.replace(/defaultTimezone: dto\.defaultTimezone \?\? 'America\/New_York',\n/, '');
srv = srv.replace(/defaultShift: dto\.defaultShift \?\? 'General Shift',\n/, '');
srv = srv.replace(/defaultStartTime: dto\.defaultStartTime \?\? '09:00',\n/, '');
srv = srv.replace(/defaultEndTime: dto\.defaultEndTime \?\? '18:00',\n/, '');

srv = srv.replace(/\.\.\.\(dto\.defaultTimezone !== undefined && \{ defaultTimezone: dto\.defaultTimezone \}\),\n/, '');
srv = srv.replace(/\.\.\.\(dto\.defaultShift !== undefined && \{ defaultShift: dto\.defaultShift \}\),\n/, '');
srv = srv.replace(/\.\.\.\(dto\.defaultStartTime !== undefined && \{ defaultStartTime: dto\.defaultStartTime \}\),\n/, '');
srv = srv.replace(/\.\.\.\(dto\.defaultEndTime !== undefined && \{ defaultEndTime: dto\.defaultEndTime \}\),\n/, '');

fs.writeFileSync('src/market-segments/market-segments.service.ts', srv);
console.log("Updated market segment backend code");
