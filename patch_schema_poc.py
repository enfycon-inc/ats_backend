with open('prisma/schema.prisma', 'r', encoding='utf-8') as f:
    code = f.read()

# Job Model - Add endClientPocId
code = code.replace(
    'endClientId          String?                @map("end_client_id") @db.Uuid',
    '''endClientId          String?                @map("end_client_id") @db.Uuid
  endClientPocId       String?                @map("end_client_poc_id") @db.Uuid'''
)
code = code.replace(
    'poc                  ClientContact?        @relation("JobPoc", fields: [pocId], references: [id])',
    '''poc                  ClientContact?        @relation("JobPoc", fields: [pocId], references: [id])
  endClientPoc         ClientContact?        @relation("JobEndClientPoc", fields: [endClientPocId], references: [id])'''
)

with open('prisma/schema.prisma', 'w', encoding='utf-8') as f:
    f.write(code)
print('Updated Prisma Schema with End Client POC')
