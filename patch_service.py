import re

with open('src/jobs/jobs.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# We need to add pocId and endClientPocId to the prisma.job.create and prisma.job.update payload.
code = code.replace(
    'endClientId: resolvedEndClientId,',
    'endClientId: resolvedEndClientId,\n            pocId: dto.pocId || undefined,\n            endClientPocId: dto.endClientPocId || undefined,'
)

# And for update:
code = code.replace(
    'endClientId: resolvedEndClientId || undefined,',
    'endClientId: resolvedEndClientId || undefined,\n            pocId: dto.pocId !== undefined ? dto.pocId : undefined,\n            endClientPocId: dto.endClientPocId !== undefined ? dto.endClientPocId : undefined,'
)

with open('src/jobs/jobs.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)
print('Patched Service')
