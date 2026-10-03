import re

with open('src/business-units/business-units.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

code = re.sub(r'country:\s*string\s*\|\s*null;\n', '\n', code)
code = re.sub(r'\|\|\s*existing\.jobsCount\s*>\s*0', '', code)
code = re.sub(r'and\s*\$\{\s*existing\.jobsCount\s*\}\s*job\s*requisition\(s\)\.', '.', code)

with open('src/business-units/business-units.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)
