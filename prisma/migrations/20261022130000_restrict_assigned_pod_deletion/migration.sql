-- Retain job-to-pod assignments when a pod deletion is attempted.
-- Job deletion still cascades through job_pods_job_id_fkey.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.job_pods
  DROP CONSTRAINT job_pods_pod_id_fkey,
  ADD CONSTRAINT job_pods_pod_id_fkey FOREIGN KEY (pod_id)
    REFERENCES ats.pods(id) ON UPDATE CASCADE ON DELETE RESTRICT;

COMMIT;
