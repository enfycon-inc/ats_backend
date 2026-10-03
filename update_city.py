import re
file_path = 'prisma/schema.prisma'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

# I will add city String? right after state String? in the Job model only
job_match = re.search(r'(model Job \{.*?\n\})', code, re.DOTALL)
if job_match:
    job_block = job_match.group(1)
    job_block = re.sub(r'(\s*state\s+String\?\s+@db\.VarChar\(100\)\n)', r'\1    city                 String?                @db.VarChar(100)\n', job_block)
    code = code[:job_match.start()] + job_block + code[job_match.end():]

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
