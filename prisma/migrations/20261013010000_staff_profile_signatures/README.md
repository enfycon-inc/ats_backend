# Staff profile rollout

Apply this migration through the reviewed deployment migration process before deploying the updated backend and frontend. It creates profile details, protected photo storage, and email signature tables; no existing user data is rewritten. Existing users start with empty optional phone and designation fields.

The migration is transactional and uses a five-second lock timeout. A lock timeout fails the migration for a later retry instead of waiting indefinitely. It has the release controller's rollback compatibility marker and passed its additive migration validator.

For an application rollback, retain these tables and deploy the previous application images. Do not drop the tables: they contain user-created profile data and signatures. Existing users.profile_picture stores a versioned authenticated photo route. Retained photos remain protected; older clients that do not support that route may show initials until the updated frontend returns.

Profile photo operations and signatures are bound to the authenticated user and workspace. Pictures are decoded and re-encoded as WebP; email HTML is sanitized on save, preview, and use. New-message signatures are appended once when campaigns are queued. Reply/forward defaults are stored and supported by the service helper, but the current application has no reply composer.

The canonical API contract is src/auth/profile-contract.ts. Keep the frontend lib/profile-contract.ts byte-identical when changing this contract. Both projects must pass their TypeScript checks.

Local validation used mocked persistence and in-memory images. The configured database was not migrated or modified.
