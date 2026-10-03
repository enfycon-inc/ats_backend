import re

with open('prisma/schema.prisma', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add commissionPercentage + contractMarkup to Client model
client_match = re.search(r'(model Client \{.*?)(@@unique\(\[tenantId, clientCode\]\))', content, re.DOTALL)
if client_match:
    client_block = client_match.group(1)
    if 'commissionPercentage' not in client_block:
        client_block += '  commissionPercentage  Decimal?  @map(\"commission_percentage\") @db.Decimal(5, 2)\n'
        client_block += '  contractMarkup        Decimal?  @map(\"contract_markup\") @db.Decimal(5, 2)\n'
        client_block += '  clientContacts        ClientContact[]\n'
    content = content[:client_match.start()] + client_block + client_match.group(2) + content[client_match.end():]

# 2. Add poc_id to Job model - insert before closing brace of Job model
job_match = re.search(r'(model Job \{.*?)(@@map\(\"jobs\"\))', content, re.DOTALL)
if job_match:
    job_block = job_match.group(1)
    if 'pocId' not in job_block:
        job_block += '  pocId                String?               @map(\"poc_id\") @db.Uuid\n'
        job_block += '  poc                  ClientContact?        @relation(\"JobPoc\", fields: [pocId], references: [id])\n'
    content = content[:job_match.start()] + job_block + job_match.group(2) + content[job_match.end():]

# 3. Add ClientContact model before closing of schema - insert before the last model
# Find position just before the RecruiterSubmission model
insert_before = 'model RecruiterSubmission {'
if 'model ClientContact {' not in content:
    client_contact_model = '''model ClientContact {
  id          String   @id @default(dbgenerated(\"gen_random_uuid()\")) @db.Uuid
  tenantId    String   @map(\"tenant_id\") @db.Uuid
  clientId    String   @map(\"client_id\") @db.Uuid
  createdBy   String   @map(\"created_by\") @db.Uuid
  name        String   @db.VarChar(255)
  designation String?  @db.VarChar(255)
  email       String?  @db.VarChar(255)
  phone       String?  @db.VarChar(50)
  linkedinUrl String?  @map(\"linkedin_url\") @db.VarChar(500)
  isPrimary   Boolean  @default(false) @map(\"is_primary\")
  notes       String?
  createdAt   DateTime @default(now()) @map(\"created_at\") @db.Timestamptz(6)
  client      Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  creator     User     @relation(\"ContactCreator\", fields: [createdBy], references: [id])
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  jobs        Job[]    @relation(\"JobPoc\")

  @@map(\"client_contacts\")
  @@schema(\"ats\")
}

'''
    content = content.replace(insert_before, client_contact_model + insert_before)

with open('prisma/schema.prisma', 'w', encoding='utf-8') as f:
    f.write(content)
print('Schema patched successfully.')
