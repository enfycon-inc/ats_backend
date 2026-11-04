# Delivery dashboard: periods and city performance

The dashboard uses the authenticated user's current approved branch/unit membership. Job, submission and staff sections require their existing read capabilities. No filter widens that scope.

## Dates

The unit timezone takes precedence over the branch timezone. The existing Asia/Kolkata fallback applies when neither is configured. Today starts at local midnight; weeks start Monday. Current week/month/year end at the next local midnight. Previous month/year cover their complete calendar periods. Custom end dates are inclusive, implemented as an exclusive next-midnight boundary. All time removes date bounds.

- Job counts use job creation dates and current job status. Active-job priority counts are separate from employment types.
- Round outcomes use submission creation dates. Later rounds require preceding rounds to be cleared, so unstarted default values do not inflate pending totals. Cleared counts overlap across rounds.
- Offers received and joins use the first genuine transition event into OFFER or JOIN, respectively. Each application counts once, even if the status is re-entered. Offers received includes applications submitted earlier and candidates who later joined.
- Legacy outcomes without recorded transition dates are disclosed separately; update timestamps are not substituted as offer/join dates.

## City and employee attribution

Cities come from approved employees in the current unit, including zero-activity and inactive accounts so historical work remains attributable. The basis is current staff city, not historical office location, candidate location or job location. Missing city values appear as City not recorded.

Jobs use the original creator. Recruiter-origin submissions and their milestones use the original CREATED event actor, falling back to the recorded recruiter when no actor was recorded. Reassigned recruiters do not replace a recorded original submitter. Website applications are not credited to staff. Missing creators/submitters are disclosed separately.

All employees are available. Recruiter and account-manager views use submission:create and job:create capabilities from assigned role bundles as functional filters. These views do not grant access. Employees with both capabilities remain a single row in their city.

One city uses a full-width panel. Two cities are side by side; three or four wrap. Five or more use a comparison table with expandable city details. Employee lists paginate per city, with ten rows per page in a bounded scrolling table. Charts default to the top three with a top-five option, using a common scale across cities. The submission chart includes separately labeled offer and join segments; these are overlapping outcomes, not an additional submission total. All matching employees remain available in the table. City totals follow the employee search/view selection. The filter bar, job summary strip and round-status matrix use the approved compact comparison layout.

The summary and selected submission IDs are calculated in a parameterized database query. The application fetches only the selected ten submission details, and batches staff identity lookups. Existing searchable multi-select entity filters continue to apply to the submission list.

## Validation

Run the normal focused dashboard unit and presentation tests. scripts/test-delivery-analytics.cjs validates the actual SQL using a separately created disposable postgres:16-alpine container named ats-delivery-analytics-check with no network or mounted user data. It creates synthetic tables only and does not load DATABASE_URL. The container must be removed after checks.

No database migration is required.

## Popup drilldowns

Period and employee city are rendered in the shared tab-row toolbar. The period caption shows full calendar boundaries in the unit timezone; current-period queries still stop after the current local day. Popup context explains this as Through today.

There is no permanent submission table in analytics mode. Pipeline statuses, final outcomes and employee selections open paginated submission dialogs with poster/submitter email identities and Open submission / Open job links. Job totals, statuses, priorities and types open a job dialog. GET /api/business-units/current/dashboard/jobs requires job:view and the existing fresh unit scope; city filters additionally require user:manage. It reuses the analytics selected_jobs CTE, including normalized status/type/priority and original-poster city, and returns ten jobs per page through the shared DeliveryJobPage contract. Popup data loads on demand with cache keys including scope, period, cities, filters and page; stale data is hidden when filters change.

### Job-page navigation revision

Job totals, statuses, priorities and types now navigate to All Jobs (or Active Jobs for Active) rather than opening the job dialog. The previous dashboard-job endpoint remains available. The URL carries delivery=1, period, cities, deliveryFrom/deliveryTo for custom ranges, status, priority and jobType. The catalog validates dashboard access against fresh membership, restricts to the current branch/unit and applies unit-local period boundaries and current approved original-poster city. Status, priority and job-type aliases match the dashboard. The destination displays the carried filter context and provides Clear filters. Submission outcomes keep their dialogs. Final uses blue Selected, amber Offer and green Joined; the separate Offers received action is removed.

## Approved readability layout

### Functional performance revision

The overview's employee section now uses Account Managers / Recruiters tabs instead of a chart metric selector. Managers show Total (canonical postedJobs), Active, Closed and Closure (joined). Recruiters show Assigned (unique active direct plus permitted pod workload), Submission, Rejected and Closure. Rejected counts each submitted record once when its current internal/final or L1/L2/L3 state is rejected, including final NOT_SELECTED and excluding withdrawal/cancellation-only records.

Manager Total, Active and Closed share the selected approval-date cohort; statuses are current, not historical snapshots. The same basis applies to expanded comparisons, client summaries and ordinary manager job drilldowns. Explicit attention queues continue to show the current portfolio. The upper job overview uses job creation date/original poster, while manager metrics use approval date/current account owner; those sections need not reconcile by date or owner. Unknown approval dates are excluded from finite periods and retained for All time.

The canonical comparison services accept validated cities and performance=1. In this mode approved staff including zero-activity/inactive staff are retained, and the response supplies city totals and top-three rows from the same ordered canonical records used by the full table. The expanded city dialogs reuse AccountManagerComparison and RecruiterComparison with isolated state, city/period filters and existing column preferences/controls. Direct full tabs retain their ordinary workspace state. Global job/pipeline totals retain their existing attribution; functional manager metrics use the full manager tab's account-manager ownership and approval-date definitions. Period timestamps are normalized to canonical UTC ISO strings at the frontend boundary. No schema migration is required.

The overview uses the global system font and shared Tailwind text utilities. L1, L2 and L3 use individual cards with vertical status rows; Final is a separate strip. Period, dates and employee city remain in the filter bar. Employee view and employee search are removed from this overview.

City headers use a location icon and View all employees action. Employee identity combines the existing profile image (or initials), name and email in one cell. The action opens a full-size accessible dialog for the selected city and period, reusing ten-row server pagination. This keeps zero-activity employees available without unbounded data loading. The shared employee contract exposes the existing nullable profile image; no additional database field is created.
