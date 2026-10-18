-- ATS: rollback-compatible
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE "ats"."session_revocations" (
    "keycloak_id" VARCHAR(255) NOT NULL,
    "session_id" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_revocations_pkey" PRIMARY KEY ("keycloak_id", "session_id")
);
COMMIT;
