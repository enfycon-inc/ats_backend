const fs = require('fs');
let content = fs.readFileSync('src/market-segments/market-segments.controller.ts', 'utf8');

content = content.replace(
  `findAll() {
    return this.marketSegmentsService.findAll();
  }`,
  `async findAll() {
    const data = await this.marketSegmentsService.findAll();
    console.log("MARKETS RETURNED TO CLIENT:", data.length);
    return data;
  }`
);

fs.writeFileSync('src/market-segments/market-segments.controller.ts', content);
console.log("Added backend logging");
