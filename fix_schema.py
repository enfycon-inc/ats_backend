import re
file_path = 'prisma/schema.prisma'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Isolate BusinessUnit model
bu_match = re.search(r'(model BusinessUnit \{.*?\n\})', content, re.DOTALL)
if bu_match:
    bu_block = bu_match.group(1)
    
    # Remove jobs Job[] relation
    bu_block = re.sub(r'\s*jobs\s+Job\[\].*?\n', '\n', bu_block)
    
    content = content[:bu_match.start()] + bu_block + content[bu_match.end():]

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
