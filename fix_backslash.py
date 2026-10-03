import re
file_path = 'src/jobs/dtos/create-job.dto.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("\'Dallas\'", "'Dallas'").replace("\'City\'", "'City'")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)

file_path = 'src/jobs/dtos/update-job.dto.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("\'Dallas\'", "'Dallas'").replace("\'City\'", "'City'")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
