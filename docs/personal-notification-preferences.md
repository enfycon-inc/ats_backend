# Personal notification preferences

Apply migration `20261025120000_personal_notification_preferences` before running the updated backend. It adds a JSON preferences field and a durable email outbox; it does not rewrite candidate, job or user records. The migration passes the blue-green additive migration guard and uses a five-second lock timeout. No migration has been applied by this implementation.

Approval and queued messages commit together. The existing role-request worker dispatches queued approval emails, retries provider failures, and rechecks reviewer eligibility and optional email preferences before sending. Recipients are deduplicated by user per event/category. Delivery is at least once: a provider timeout after acceptance can still cause a repeated email. Failed messages stop after five attempts.

Registration acknowledgement, initial approval/welcome, invitations and recovery/security messages remain automatic. Optional role request, reviewer approval, role change and pod lead emails respect saved choices. The preferences endpoint derives available controls from current assigned permissions; the server rejects ineligible settings. Missing optional choices default to enabled.

Sound and popup settings are personal server settings. Alert category switches mute presentation without deleting notification history. Settings refresh on focus/reconnection and periodically. Failed saves are reported instead of showing success.

On application rollback, stop the new worker and retain the additive schema. Older images ignore these fields and records; they do not enforce the newly introduced optional email choices. Reconcile pending outbox records before resuming a later release.
