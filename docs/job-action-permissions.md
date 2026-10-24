# Job action permissions

No schema migration is required. Deploy the backend and frontend together because the interface uses backend job capabilities. This change does not modify existing role assignments automatically.

| Action | Owner | Current unit | Current branch | Tenant |
| --- | --- | --- | --- | --- |
| Edit details | `job:edit` | `job:edit_unit` | `job:edit_branch` | `job:edit_tenant` |
| Change status | `job:change_status` | `job:change_status_unit` | `job:change_status_branch` | `job:change_status_tenant` |
| Find AI matches | `job:find_matches` | `job:find_matches_unit` | `job:find_matches_branch` | `job:find_matches_tenant` |

Before rollout, use Role Management to explicitly assign the new status and matching permissions to the applicable permission bundles. Existing `job:edit` becomes ownership-scoped; it no longer grants access to another owner's job. Existing `job:view` alone no longer grants AI matching. Reading a job and using an action remain separate checks.

Ownership uses `accountManagerId` and the authenticated database user ID. Creating on behalf of someone else, sharing a job, or being its recruitment manager does not grant ownership. Owner access also requires the current branch and, when configured, current unit. Missing scope identifiers fail closed. Wider action grants are explicit exceptions.

Existing broad management capabilities remain administrative grants: tenant management/settings and platform management operate within the resolved tenant; branch management operates within the current branch; unit management operates within the current branch and unit. Runtime authorization does not inspect role names. An active role's existing permission resolution determines the permissions supplied to this policy.

Staffing-only requests continue through their existing recruiter/pod assignment policy. Draft editing continues through its existing ownership and creation-grant policy. Operational status transitions retain their existing approval, client, and concurrency checks.

The backend emits `capabilities.edit`, `capabilities.changeStatus`, and `capabilities.findMatches` on job list/detail responses. Buttons use these values but every action independently rechecks access. Status failures stay in the status dialog; edit and matching navigation failures use in-page errors.

Rollback: restore the prior backend and frontend together. The added permission strings can remain inert in role configuration or be removed through Role Management. No table or record rollback is needed.
