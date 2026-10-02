const fs = require('fs');
const file = 'src/jobs/jobs.service.ts';
let c = fs.readFileSync(file, 'utf8');

const regex = /async getDelegationRequests[\s\S]*?orderBy: \{ createdAt: 'desc' \},\s*\}\);\s*\}/;

const newFunc = `async getDelegationRequests(tenantId: string, branchId?: string, type: 'incoming' | 'outgoing' | 'all' = 'all', user?: any) {
    if (!branchId) throw new BadRequestException('User must belong to a branch');
    
    const whereClause: any = { tenantId };
    if (type === 'incoming') {
      whereClause.targetBranchId = branchId;
    } else if (type === 'outgoing') {
      whereClause.sourceBranchId = branchId;
    } else {
      whereClause.OR = [
        { targetBranchId: branchId },
        { sourceBranchId: branchId },
      ];
    }

    const requests = await this.prisma.jobDelegationRequest.findMany({
      where: whereClause,
      include: { 
        job: {
          include: {
            clientRef: { select: { clientName: true } },
            endClientRef: { select: { clientName: true } }
          }
        },
        sourceBranch: { select: { id: true, name: true } },
        targetBranch: { select: { id: true, name: true } },
        sourceUnit: { select: { id: true, name: true } },
        assignedPod: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [...new Set(requests.map(r => r.job?.accountManagerId).filter(Boolean))] as string[];
    let usersMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true, email: true }
      });
      usersMap = users.reduce((acc: any, u: any) => { acc[u.id] = u; return acc; }, {});
    }

    return requests.map(req => {
      if (req.job) {
        (req.job as any).client = (req.job as any).clientRef?.clientName || null;
        (req.job as any).endClient = (req.job as any).endClientRef?.clientName || null;
        const am = req.job.accountManagerId ? usersMap[req.job.accountManagerId] : null;
        (req.job as any).createdBy = am?.fullName || am?.email || null;
        (req.job as any).accountManagerName = am?.fullName || am?.email || null;
      }
      return req;
    });
  }`;

c = c.replace(regex, newFunc);
fs.writeFileSync(file, c);
console.log('Successfully patched using regex.');
