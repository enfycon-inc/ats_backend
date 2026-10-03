import re
file_path = 'src/jobs/jobs.service.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace(
    'let resolvedClientId = null;',
    'let resolvedClientId: string | null = null;'
)
code = code.replace(
    'let resolvedEndClientId = null;',
    'let resolvedEndClientId: string | null = null;'
)

code = code.replace(
    'workMode: dto.workMode || dto.remoteJob || \'In Office\',',
    'workMode: dto.workMode || (dto as any).remoteJob || \'In Office\','
)

code = code.replace(
    'else if (dto.remoteJob !== undefined) data.workMode = dto.remoteJob;',
    'else if ((dto as any).remoteJob !== undefined) data.workMode = (dto as any).remoteJob;'
)

code = code.replace(
    'const jobRemote = (job.remoteJob || \'\').toLowerCase();',
    'const jobRemote = (job.workMode || \'\').toLowerCase();'
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
