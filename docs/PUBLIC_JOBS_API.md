# Public jobs and applications API

This API is for tenant career sites. API keys are read-only for job data and can only submit candidate applications. They cannot create, update, publish, archive, or delete jobs, and cannot read candidate or applicant records.

## Issue and revoke a key

Key administration uses the ATS user session and is restricted by the backend to users with `tenant:settings` or `tenant:manage` in their own tenant.

- `POST /api/public-jobs/keys` with `{ "name": "Careers site", "scope": "BRANCH", "branchId": "...", "expiresAt": "2027-01-01T00:00:00Z", "allowedOrigins": ["https://careers.example.com"] }`
- `GET /api/public-jobs/keys` lists metadata only.
- `DELETE /api/public-jobs/keys/{id}` revokes immediately.

Scopes are `TENANT`, `BRANCH`, and `BUSINESS_UNIT`. Branch and unit IDs are checked against the authenticated tenant. Expiry is required and limited to 366 days. The generated `epk_live_...` secret is returned only once; only its SHA-256 hash is stored. Keep it in the website server's secret store. Do not put it in browser JavaScript, HTML, source control, or URLs.

## Authentication

Send the API key in `Authorization: Bearer <key>` over HTTPS. The server checks the hash, revocation, expiration, and tenant active state on every request. `Origin` allowlists and CORS are browser controls, not substitutes for the key. Prefer a server-side website proxy for all calls so the key is not exposed to visitors.

## Read published jobs

- `GET /api/public/jobs?limit=20&cursor=<nextCursor>&search=engineer`
- `GET /api/public/jobs/{slug}`

Only active, approved, explicitly published, non-deleted jobs within the key's scope are returned. Results are paginated (maximum 50). Responses omit client details, recruiter information, internal rates, assignments, and tenant IDs. Descriptions are HTML-sanitized. A closed, deleted, or unpublished job immediately disappears from public reads.

Only ATS users with job editing or tenant administration permission can publish/unpublish through `PATCH /api/jobs/{id}/publication` with `{ "published": true, "publicDescription": "..." }` or `{ "published": false }`. A separate sanitized public description is required; the internal job description is never copied into the public feed. This endpoint uses the ATS session, never the public API key.

## Submit an application

`POST /api/public/jobs/{slug}/applications` as `multipart/form-data`. Required fields:

| Field | Validation |
| --- | --- |
| `fullName`, `email` | Candidate identity; email must be valid. |
| `consent` | Must be `true`. |
| `resume` | PDF or DOCX, maximum 8 MB. |
| `totalExperienceYears`, `relevantExperienceYears` | 0–100 years, up to one decimal; relevant cannot exceed total. |
| `currentCompany` | Required, up to 255 characters. |
| `currentLocation` | Required, up to 255 characters. |
| `preferredLocations` | Required; send a comma-separated list or repeated multipart fields, 1–20 locations, up to 255 characters each. |
| `noticePeriodDays` | Required integer from 0 to 3650; use `0` for immediate availability. |
| `currentCompensation`, `expectedCompensation` | Both required, positive amounts, up to two decimals. These are **Current CTC** and **Expected CTC**. |
| `compensationCurrency`, `compensationInputUnit` | Required. Supported currencies: INR, USD, CAD, GBP, EUR. Units must match the job type: LPA (INR only) or YEAR for non-contract jobs; MONTH for contract jobs. |

Optional `phone` may be supplied. `source`, recruiter assignment, ATS status, and internal `remarks` are not applicant-controlled fields; remarks are not accepted by this API. A website server should proxy the form submission and attach the API key; never send the key to the browser.

The backend rechecks job publication and key scope when applying. It creates or reuses the tenant candidate profile, saves the submitted experience, company, location, notice period, preferred locations, and CTC details to the ATS candidate/submission, stores the resume privately, records source as `Company Website` / `Direct Application` / `Website`, and creates a `PENDING_APPROVAL` ATS submission. Duplicate applications for the same email and job return the existing receipt. The response includes only `{ "received": true, "reference": "..." }`.

In the ATS, the recruiter label is **Website Applicant**. Applications appear in the internal review queue for authorized tenant/branch/unit reviewers with `submission:internal_screening`. Website applicants are not assigned to a recruiter until an ATS user claims or assigns them. The developer key cannot list applications or download resumes.

## Common errors

- `401`: missing, invalid, expired, or revoked API key.
- `403`: scope or permission does not allow the operation.
- `404`: job is not available within this key's scope.
- `400`: invalid fields, consent, or resume.
