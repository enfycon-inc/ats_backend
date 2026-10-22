-- Restores the prior cascading behavior. Run only when rolling back this feature.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.job_pods
  DROP CONSTRAINT job_pods_pod_id_fkey,
  ADD CONSTRAINT job_pods_pod_id_fkey FOREIGN KEY (pod_id)
    REFERENCES ats.pods(id) ON UPDATE CASCADE ON DELETE CASCADE;

COMMIT;
