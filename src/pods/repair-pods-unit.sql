-- Safe, idempotent SQL script to associate Pod 1 and Pod 2 with Domestic Recruitment operating unit
-- Pod 1: d9026dbd-e941-4fee-aaa3-e9337313ee13
-- Pod 2: 3f2c3da3-7b62-40d9-b523-2fadaa6fdc38
-- Domestic Recruitment BU: 703e5263-a50d-4484-8ad5-d382625b8b87

DO $repair$
DECLARE
  v_bu_id uuid := '703e5263-a50d-4484-8ad5-d382625b8b87'::uuid;
  v_branch_id uuid;
BEGIN
  -- Verify the target operating unit exists
  SELECT branch_id INTO v_branch_id FROM ats.business_units WHERE id = v_bu_id;

  IF v_branch_id IS NOT NULL THEN
    -- Update Pod 1 and Pod 2 if business_unit_id is NULL
    UPDATE ats.pods
    SET business_unit_id = v_bu_id,
        branch_id = COALESCE(branch_id, v_branch_id),
        updated_at = NOW()
    WHERE id IN (
      'd9026dbd-e941-4fee-aaa3-e9337313ee13'::uuid,
      '3f2c3da3-7b62-40d9-b523-2fadaa6fdc38'::uuid
    ) AND business_unit_id IS NULL;

    RAISE NOTICE 'Pod 1 and Pod 2 associated with operating unit %', v_bu_id;
  ELSE
    RAISE NOTICE 'Operating unit % not found. Skipping static Pod 1/2 repair.', v_bu_id;
  END IF;

  -- Backfill any other orphaned pods whose members or lead all belong to a single operating unit
  UPDATE ats.pods p
  SET business_unit_id = sub.single_bu,
      branch_id = COALESCE(p.branch_id, bu.branch_id),
      updated_at = NOW()
  FROM (
    SELECT u.pod_id, u.business_unit_id AS single_bu
    FROM ats.users u
    WHERE u.pod_id IS NOT NULL AND u.business_unit_id IS NOT NULL
    GROUP BY u.pod_id, u.business_unit_id
    HAVING COUNT(DISTINCT u.business_unit_id) = 1
  ) sub
  JOIN ats.business_units bu ON bu.id = sub.single_bu
  WHERE p.id = sub.pod_id AND p.business_unit_id IS NULL;

END $repair$;
