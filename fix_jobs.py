import re
file_path = 'src/jobs/jobs.service.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

client_resolution = '''
      // Client Resolution
      let resolvedClientId = null;
      let resolvedEndClientId = null;

      if (dto.client && dto.client.trim() !== '') {
        let cName = dto.client.trim();
        const existingC = await this.prisma.client.findFirst({
          where: { clientName: { equals: cName, mode: 'insensitive' }, tenantId }
        });
        if (existingC) resolvedClientId = existingC.id;
        else {
          const newC = await this.prisma.client.create({ data: { clientName: cName, tenantId } });
          resolvedClientId = newC.id;
        }
      }

      if (dto.endClientName && dto.endClientName.trim() !== '') {
        let ecName = dto.endClientName.trim();
        const existingEc = await this.prisma.client.findFirst({
          where: { clientName: { equals: ecName, mode: 'insensitive' }, tenantId }
        });
        if (existingEc) resolvedEndClientId = existingEc.id;
        else {
          const newEc = await this.prisma.client.create({ data: { clientName: ecName, tenantId } });
          resolvedEndClientId = newEc.id;
        }
      }
'''

code = code.replace(
    '''const resolvedAccountManagerId = await this.resolveUserUuid(dto.accountManagerId || ((createdByEmail && createdByEmail !== 'System') ? createdByEmail : null), tenantId);''',
    '''const resolvedAccountManagerId = await this.resolveUserUuid(dto.accountManagerId || ((createdByEmail && createdByEmail !== 'System') ? createdByEmail : null), tenantId);
    ''' + client_resolution
)

code = code.replace(
    'remoteJob: dto.remoteJob || \'No\',',
    'workMode: dto.workMode || dto.remoteJob || \'In Office\','
)
code = code.replace(
    '''market: dto.market || 'US',''',
    '''market: (dto.market === 'IND' ? 'IN' : dto.market) || 'US',
            clientId: resolvedClientId,
            endClientId: resolvedEndClientId,'''
)

code = code.replace(
    'remoteJob: row.remote_job ?? row.remoteJob ?? \'No\',',
    'workMode: row.work_mode ?? row.workMode ?? \'In Office\','
)

code = code.replace(
    'if (dto.remoteJob !== undefined) data.remoteJob = dto.remoteJob;',
    '''if (dto.workMode !== undefined) data.workMode = dto.workMode;
    else if (dto.remoteJob !== undefined) data.workMode = dto.remoteJob;'''
)

code = code.replace(
    'remoteJob: original.remoteJob || \'No\',',
    'workMode: (original as any).workMode || (original as any).remoteJob || \'In Office\','
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
