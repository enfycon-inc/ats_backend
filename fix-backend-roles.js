
const fs = require("fs");
const path = require("path");

const p = path.join(__dirname, "src/auth/services/auth-rbac.service.ts");
let c = fs.readFileSync(p, "utf8");

c = c.replace(
  "    if (branchId) {",
  "    if (branchId && branchId !== \"all\" && branchId !== \"undefined\" && branchId !== \"null\") {"
);

fs.writeFileSync(p, c);
console.log("Fixed backend auth-rbac.service.ts");

