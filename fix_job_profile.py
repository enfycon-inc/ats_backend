import re
file_path = 'src/jobs/jobs.service.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace(
    'remoteJob: string;',
    'workMode: string;'
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
