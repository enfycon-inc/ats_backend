-- ATS: rollback-compatible
-- Additive history storage; older backend images continue using submission state.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE ats.submission_events (
 id UUID NOT NULL DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 submission_id UUID NOT NULL, actor_id VARCHAR(255), actor_name VARCHAR(255),
 kind VARCHAR(50) NOT NULL, sequence INTEGER NOT NULL, request_id VARCHAR(100) NOT NULL,
 request_hash VARCHAR(64) NOT NULL, details JSONB NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT submission_events_pkey PRIMARY KEY (id),
 CONSTRAINT submission_events_submission_id_fkey FOREIGN KEY (submission_id)
 REFERENCES ats.recruiter_submissions(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX submission_events_submission_id_request_id_key ON ats.submission_events(submission_id, request_id);
CREATE UNIQUE INDEX submission_events_submission_id_sequence_key ON ats.submission_events(submission_id, sequence);
CREATE INDEX submission_events_tenant_id_submission_id_sequence_idx ON ats.submission_events(tenant_id, submission_id, sequence);
COMMIT;
