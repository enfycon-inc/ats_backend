import re
import os

for filename in ['src/jobs/dtos/create-job.dto.ts', 'src/jobs/dtos/update-job.dto.ts']:
    if not os.path.exists(filename): continue
    with open(filename, 'r', encoding='utf-8') as f:
        code = f.read()
    
    if 'city?: string;' not in code:
        code = re.sub(
            r'(@ApiPropertyOptional\(\{.*?\'State.*?\n\s*state\?:\s*string;)', 
            r'\1\n\n  @ApiPropertyOptional({ example: \'Dallas\', description: \'City\' })\n  city?: string;', 
            code
        )
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(code)

with open('src/jobs/jobs.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# create mapping
if 'city: dto.city || null,' not in code:
    code = re.sub(
        r'(state:\s*dto\.state\s*\|\|\s*\'\',)',
        r'\1\n          city: dto.city || null,',
        code
    )

# update mapping
if 'dataToUpdate.city = dto.city;' not in code:
    code = re.sub(
        r'(if\s*\(dto\.state\s*!==\s*undefined\)\s*dataToUpdate\.state\s*=\s*dto\.state;)',
        r'\1\n    if (dto.city !== undefined) dataToUpdate.city = dto.city;',
        code
    )

# JobProfile interface mapping
if 'city: string | null;' not in code:
    code = re.sub(
        r'(state:\s*string;)',
        r'\1\n  city: string | null;',
        code
    )
if 'city: row.city || null,' not in code:
    code = re.sub(
        r'(state:\s*row\.state\s*\|\|\s*\'\',)',
        r'\1\n      city: row.city || null,',
        code
    )
if 'city: original.city,' not in code:
    code = re.sub(
        r'(state:\s*original\.state,)',
        r'\1\n      city: original.city,',
        code
    )

with open('src/jobs/jobs.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)
