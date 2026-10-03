import re

with open('prisma/schema.prisma', 'r', encoding='utf-8') as f:
    content = f.read()

# Add clientContacts relation to User model
user_match = re.search(r'(model User \{.*?)(@@map\(\"users\"\))', content, re.DOTALL)
if user_match:
    user_block = user_match.group(1)
    if 'createdContacts' not in user_block:
        user_block += '  createdContacts      ClientContact[]       @relation(\"ContactCreator\")\n'
    content = content[:user_match.start()] + user_block + user_match.group(2) + content[user_match.end():]

# Add clientContacts relation to Tenant model
tenant_match = re.search(r'(model Tenant \{.*?)(@@map\(\"tenants\"\))', content, re.DOTALL)
if tenant_match:
    tenant_block = tenant_match.group(1)
    if 'clientContacts' not in tenant_block:
        tenant_block += '  clientContacts       ClientContact[]\n'
    content = content[:tenant_match.start()] + tenant_block + tenant_match.group(2) + content[tenant_match.end():]

with open('prisma/schema.prisma', 'w', encoding='utf-8') as f:
    f.write(content)
print('Schema patched successfully.')
