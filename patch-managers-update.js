const fs = require('fs');
const file = 'src/branches/branches.service.ts';
let c = fs.readFileSync(file, 'utf8');

const regex = /async updateManagers\([\s\S]*?return \{ message: 'Branch managers updated successfully.' \};\s*\}/;

const replacement = `async updateManagers(branchId: string, managerIds: string[], tenantId: string) {
    await this.findOne(branchId, tenantId);

    if (managerIds && managerIds.length > 0) {
      const branchAdminRole = await this.prisma.customRole.findFirst({
        where: { tenantId, systemRole: { systemKey: 'BRANCH_ADMIN' } }
      });
      
      if (!branchAdminRole) {
        throw new BadRequestException('Branch Admin role not found for this tenant.');
      }

      await this.prisma.user.updateMany({
        where: { id: { in: managerIds }, tenantId },
        data: { roleId: branchAdminRole.id, branchId }
      });
    }

    return { message: 'Branch managers updated successfully.' };
  }`;

c = c.replace(regex, replacement);
fs.writeFileSync(file, c);
