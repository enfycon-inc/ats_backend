import re

with open('src/jobs/dtos/create-job.dto.ts', 'r', encoding='utf-8') as f:
    code = f.read()

injection = '''
  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'POC ID' })
  pocId?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'End Client POC ID' })
  endClientPocId?: string;
'''
code = code.replace('endClientName?: string;', 'endClientName?: string;' + injection)

with open('src/jobs/dtos/create-job.dto.ts', 'w', encoding='utf-8') as f:
    f.write(code)
print('Patched DTO')
