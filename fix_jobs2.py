import re
file_path = 'src/jobs/jobs.service.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

code = re.sub(r'\s*businessUnitId:\s*dto\.businessUnitId\s*\|\|\s*null,', '', code)
code = re.sub(r'\s*businessUnitId:\s*row\.business_unit_id\s*\?\?\s*row\.businessUnitId\s*\?\?\s*null,', '', code)
code = re.sub(r'const jobLocLower = \(job\.location\s*\|\|\s*\'\'\)\.toLowerCase\(\);', 'const jobLocLower = "";', code)
code = re.sub(r'\|\|\s*!job\.location', '', code)
code = re.sub(r'\s*location:\s*original\.location,', '', code)
code = re.sub(r'\s*sourceUnitId:\s*job\.businessUnitId,', '', code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
