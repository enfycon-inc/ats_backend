import re, os

# Update backend clients DTO to include commissionPercentage and contractMarkup
for dto_path in ['src/clients/dtos/create-client.dto.ts', 'src/clients/dtos/update-client.dto.ts']:
    if not os.path.exists(dto_path): continue
    with open(dto_path, 'r', encoding='utf-8') as f:
        code = f.read()
    
    if 'commissionPercentage' not in code:
        # Add at the end before closing brace
        code = code.rstrip()
        if code.endswith('}'):
            code = code[:-1] + '''
  @ApiPropertyOptional({ example: 8.33, description: 'Standard permanent placement commission %' })
  commissionPercentage?: number;

  @ApiPropertyOptional({ example: 20, description: 'Standard contract markup %' })
  contractMarkup?: number;
}'''
        with open(dto_path, 'w', encoding='utf-8') as f:
            f.write(code)
        print(f'Updated {dto_path}')

# Update clients service to save commissionPercentage and contractMarkup
clients_service = 'src/clients/clients.service.ts'
if os.path.exists(clients_service):
    with open(clients_service, 'r', encoding='utf-8') as f:
        code = f.read()
    
    if 'commissionPercentage' not in code:
        # Find create client data block and add fields
        code = re.sub(
            r'(approvalStatus:.*?)\n(\s*)(createdBy:)',
            r'\1\n\2commissionPercentage: dto.commissionPercentage || null,\n\2contractMarkup: dto.contractMarkup || null,\n\2\3',
            code
        )
        with open(clients_service, 'w', encoding='utf-8') as f:
            f.write(code)
        print('Updated clients.service.ts')
