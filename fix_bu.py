import re
file_path = 'src/business-units/business-units.service.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = re.sub(r'\s*jobsCount:\s*bu\._count\.jobs,', '', code)
code = re.sub(r'\s*jobs:\s*true,', '', code)
code = re.sub(r'bu\.branch\?', 'bu.branchId', code)  # just to fix the TS errors if any
code = re.sub(r'bu\.branch\.', 'bu.', code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
