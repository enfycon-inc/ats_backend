import re
import os

for filename in ['src/jobs/dtos/create-job.dto.ts', 'src/jobs/dtos/update-job.dto.ts', 'src/jobs/jobs.service.ts']:
    if not os.path.exists(filename): continue
    with open(filename, 'r', encoding='utf-8') as f:
        code = f.read()
    
    code = re.sub(r'\s*@ApiProperty.*?\n\s*location\??:\s*string;', '', code)
    code = re.sub(r'\s*location\??:\s*string;', '', code)
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(code)
