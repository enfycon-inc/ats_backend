# System Design Proposal: Interview Calendar Access

## Current architecture

Interview dates and round statuses (`L1`–`L3`) are stored on recruiter submission records. The calendar was a placeholder; there was no calendar-event table or calendar endpoint. Submission list access is enforced by the backend, and interview changes already use the submission update endpoint with workflow validation and audit history.

The Account Manager permission ceiling automatically added `submission:view_all` and `submission:edit_all`, conflicting with default ownership isolation. Submission queries also needed a branch boundary for branch-scoped oversight.

## Proposed behavior

The calendar is a projection of interview rounds on submissions, not an independent source of truth. Everyone who can view a submission can view its interview events; only users with interview scheduling permission can change them. Account Managers default to jobs assigned to them; recruiters see submissions they submitted or review; unit and branch oversight stays within the user's assigned organization; tenant-wide access requires an explicit broad permission. Cancellation is a status update with a reason and retained history, not physical deletion.

| Scope | Server-side row filter | Default actions |
| --- | --- | --- |
| Own work | Account Manager-owned jobs; recruiter-submitted or reviewed submissions | Account Manager may schedule/reschedule/cancel when granted `submission:schedule_interview`; recruiter is view-only by default |
| Unit | Jobs in the user's assigned business unit and branch | View; changes require `submission:schedule_interview` |
| Branch | Jobs in the user's assigned branch | View; changes require `submission:schedule_interview` |
| Tenant | Tenant rows only when `submission:view_all` or tenant administration scope is explicit | Changes still require `submission:schedule_interview` |

## API and data flow

- `GET /api/recruiter-submissions/calendar-events?start=&end=` returns events in a bounded date interval, including submission ID, candidate/job summary, round, date, status, and server-computed change capability.
- Scope comes from authenticated permissions and database membership. A client cannot request another user's scope by supplying IDs.
- Schedule, reschedule, and cancel go through `PATCH /api/recruiter-submissions/:id`. This preserves workflow validation, audit history, idempotency, and optimistic concurrency checks.
- The calendar uses FullCalendar and the existing permission-aware submission editor. It offers no edit action when the server marks an event as view-only.
- No event table is needed. A future external calendar integration can store provider identifiers separately without duplicating ATS scheduling state.

## Security and performance audit

- Calendar reads are tenant- and scope-filtered in the backend.
- Writes recheck submission visibility, interview permission, Account Manager ownership, and round-order rules.
- Account Manager all-submission and cross-manager edit grants are opt-in instead of injected defaults.
- The API limits date range to 93 days and flattens up to 5,000 round events in one request, avoiding per-event fetches.
- Cancellation retains submission status/date/audit history and is omitted from the calendar; completed rounds remain visible when viewing their past dates.

## Implementation note

The current `meeting_link` applies to the submission, not each round. Different L1/L2/L3 links would require a normalized per-round event model before external calendar synchronization.
