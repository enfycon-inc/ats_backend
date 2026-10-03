import re
file_path = 'src/clients/clients.service.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = re.sub(r'\s*jobLocation:\s*true,', '', code)
code = re.sub(r'\s*job_location:\s*j\.jobLocation,', '', code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
