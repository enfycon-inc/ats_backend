import re, os

for dto_path in ['src/clients/dtos/create-client.dto.ts', 'src/clients/dtos/update-client.dto.ts']:
    if not os.path.exists(dto_path): continue
    with open(dto_path, 'r', encoding='utf-8') as f:
        code = f.read()
    
    if 'msaSigned' not in code:
        code = code.rstrip()
        if code.endswith('}'):
            code = code[:-1] + '''
  @ApiPropertyOptional({ example: false })
  msaSigned?: boolean;

  @ApiPropertyOptional({ example: false })
  sowExecuted?: boolean;

  @ApiPropertyOptional({ example: 'Net-30' })
  paymentTerms?: string;
}'''
        with open(dto_path, 'w', encoding='utf-8') as f:
            f.write(code)
        print(f'Updated {dto_path}')

clients_service = 'src/clients/clients.service.ts'
if os.path.exists(clients_service):
    with open(clients_service, 'r', encoding='utf-8') as f:
        code = f.read()
    
    if 'msaSigned' not in code:
        code = re.sub(
            r'(commissionPercentage:.*?)\n(\s*)(contractMarkup:)',
            r'\1\n\2\3\n\2msaSigned: dto.msaSigned ?? false,\n\2sowExecuted: dto.sowExecuted ?? false,\n\2paymentTerms: dto.paymentTerms || null,',
            code
        )
        with open(clients_service, 'w', encoding='utf-8') as f:
            f.write(code)
        print('Updated clients.service.ts')
