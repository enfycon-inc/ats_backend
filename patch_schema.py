with open('prisma/schema.prisma', 'r', encoding='utf-8') as f:
    code = f.read()

import re

# Job Model
code = re.sub(
    r'clientBillRate\s+String\?\s+@map\("client_bill_rate"\) @db\.VarChar\(100\)\s*\n\s*payRate\s+String\?\s+@map\("pay_rate"\) @db\.VarChar\(100\)',
    '''payRateMin           Decimal?               @map("pay_rate_min") @db.Decimal(10,2)
  payRateMax           Decimal?               @map("pay_rate_max") @db.Decimal(10,2)
  payCurrency          String?                @default("INR") @map("pay_currency") @db.VarChar(10)
  payTerm              String?                @default("LPA") @map("pay_term") @db.VarChar(50)
  clientBillRateMin    Decimal?               @map("client_bill_rate_min") @db.Decimal(10,2)
  clientBillRateMax    Decimal?               @map("client_bill_rate_max") @db.Decimal(10,2)
  clientBillCurrency   String?                @default("INR") @map("client_bill_currency") @db.VarChar(10)
  clientBillTerm       String?                @default("LPA") @map("client_bill_term") @db.VarChar(50)
  placementCommissionPct Decimal?             @map("placement_commission_pct") @db.Decimal(5,2)''',
    code
)

# Submission Model
code = re.sub(
    r'submittedRate\s+String\?\s+@map\("submitted_rate"\) @db\.VarChar\(100\)',
    '''submittedRateAmount   Decimal? @map("submitted_rate_amount") @db.Decimal(10,2)
  submittedRateCurrency String?  @default("INR") @map("submitted_rate_currency") @db.VarChar(10)
  submittedRateTerm     String?  @default("LPA") @map("submitted_rate_term") @db.VarChar(50)''',
    code
)

# Candidate Model
code = code.replace(
    'candidateExpectedCtc Decimal? @map("candidate_expected_ctc") @db.Decimal(10,2)',
    '''candidateExpectedCtc Decimal? @map("candidate_expected_ctc") @db.Decimal(10,2)
  candidateCtcCurrency String?  @default("INR") @map("candidate_ctc_currency") @db.VarChar(10)
  candidateCtcTerm     String?  @default("LPA") @map("candidate_ctc_term") @db.VarChar(50)'''
)

with open('prisma/schema.prisma', 'w', encoding='utf-8') as f:
    f.write(code)
print('Updated Prisma Schema')
