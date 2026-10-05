-- Additive repair; existing jobs remain unassigned until an explicit mapping is reviewed.
ALTER TABLE ats.jobs ADD COLUMN IF NOT EXISTS business_unit_id UUID;
