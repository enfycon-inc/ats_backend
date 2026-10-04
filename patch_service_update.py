import re

with open('src/jobs/jobs.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Add pocId and endClientPocId to update data
code = code.replace(
    'if (dto.clientJobId !== undefined) dataToUpdate.clientJobId = dto.clientJobId;',
    '''if (dto.clientJobId !== undefined) dataToUpdate.clientJobId = dto.clientJobId;
    if (dto.pocId !== undefined) dataToUpdate.pocId = dto.pocId;
    if (dto.endClientPocId !== undefined) dataToUpdate.endClientPocId = dto.endClientPocId;'''
)

with open('src/jobs/jobs.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)
print('Patched Update')
