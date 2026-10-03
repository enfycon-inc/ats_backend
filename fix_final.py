import re

# Fix branches
with open('src/branches/branches.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()
code = re.sub(r'jobs:\s*true\s*,?', '', code)
with open('src/branches/branches.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)

# Fix business units
with open('src/business-units/business-units.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

code = re.sub(r'\s*jobsCount:\s*number;\n', '\n', code)
code = re.sub(r'bu\.branchId\.name', 'bu.branch?.name', code)
code = re.sub(r'bu\.branchId\.', 'bu.branch?.', code)
code = re.sub(r'\s*country:\s*bu\.country,', '', code)

# Remove job.businessUnitRef
code = re.sub(r'include:\s*\{\s*businessUnitRef:\s*true\s*\}', '', code)
code = re.sub(r'const\s+segmentId\s*=\s*job\.businessUnitRef\?\.marketSegmentId;', 'const segmentId = null;', code)
code = re.sub(r'id:\s*\{\s*not:\s*job\.businessUnitId!\s*\},?', '', code)

with open('src/business-units/business-units.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)
