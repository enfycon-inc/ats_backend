# Job action permissions

No schema migration is required. Deploy the backend and frontend together because the interface uses backend job capabilities. Deploy the release controller update as well: after schema verification it runs the versioned permission configuration from the backend image. Local bootstrap also runs this policy. No users or role assignment IDs are changed.

| Action | Owner | Current unit | Current branch | Tenant |
| --- | --- | --- | --- | --- |
| Edit details | `job:edit` | `job:edit_unit` | `job:edit_branch` | `job:edit_tenant` |
| Change status | `job:change_status` | `job:change_status_unit` | `job:change_status_branch` | `job:change_status_tenant` |
| Find AI matches | `job:find_matches` | `job:find_matches_unit` | `job:find_matches_branch` | `job:find_matches_tenant` |

The one-time `job-own-actions-v1` configuration adds `job:change_status` to existing bundles with `job:edit`, and adds `job:find_matches` only when those bundles also have `job:view` and `candidate:view`. Each changed bundle is audited with before/after values and added keys. A transaction-wide advisory lock and completion marker prevent repeat grants, including after intentional removals. Future role defaults include these own-job permissions; custom bundles remain configurable in Role Management. Existing `job:edit` becomes ownership-scoped; it no longer grants access to another owner's job. Existing `job:view` alone no longer grants AI matching. Reading a job and using an action remain separate checks.

Ownership uses `accountManagerId` and the authenticated database user ID. Creating on behalf of someone else, sharing a job, or being its recruitment manager does not grant ownership. Owner access also requires the current branch and, when configured, current unit. Missing scope identifiers fail closed. Wider action grants are explicit exceptions.

Existing broad management capabilities remain administrative grants: tenant management/settings and platform management operate within the resolved tenant; branch management operates within the current branch; unit management operates within the current branch and unit. Runtime authorization does not inspect role names. An active role's existing permission resolution determines the permissions supplied to this policy.

Staffing-only requests continue through their existing recruiter/pod assignment policy. Draft editing continues through its existing ownership and creation-grant policy. Operational status transitions retain their existing approval, client, and concurrency checks.

The backend emits `capabilities.edit`, `capabilities.changeStatus`, and `capabilities.findMatches` on job list/detail responses. Buttons use these values but every action independently rechecks access. Status failures stay in the status dialog; edit and matching navigation failures use in-page errors.

Rollback: restore the prior backend and frontend together. The added permission strings can remain inert in role configuration or be removed through Role Management. No table or record rollback is needed.

Website publication uses the same edit ownership/scope policy and is restricted to active, approved jobs. Job responses include `capabilities.managePublication` and existing publication flags. Both job menus and details use this capability. Publish/unpublish confirmations show errors inline and refresh the job list after a successful change.

Configuration rollback: inspect `JOB_OWN_ACTIONS_V1` audit entries and remove the recorded added keys through Role Management if needed, preserving unrelated subsequent changes. Do not delete completion markers: doing so would allow the initial grants to run again.
