import re
file_path = 'src/jobs/jobs.service.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = re.sub(r'\s*location:\s*row\.job_location\s*\?\?\s*row\.jobLocation,\n', '\n', code)
code = re.sub(r'\s*if\s*\(dto\.location\s*!==\s*undefined\)\s*dataToUpdate\.jobLocation\s*=\s*dto\.location;\n', '\n', code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
