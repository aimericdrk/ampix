-- Repair organizations that have NO owner.
--
-- The `owner` role arrived in 20260711024834_add_owner_role and 20260711102417_backfill_org_owner
-- promoted one admin per org, but the signup provisioning path kept writing `admin`. Every account
-- created after that migration therefore got a personal workspace with no owner at all — and an
-- ownerless org is a dead end, because the only way to become owner is an atomic transfer performed
-- BY the current owner (orgs/members/members.service.ts). Owner-only actions (deleting the org,
-- transferring ownership) are unreachable forever without this repair.
--
-- Same rule as the original backfill: promote the admin with the smallest user_id. Orgs that
-- already have an owner, and orgs with no admin at all, are left untouched — so this is safe to
-- apply to a database that is already correct, and it never demotes anyone.
WITH ownerless AS (
  SELECT DISTINCT m.org_id
  FROM memberships m
  WHERE NOT EXISTS (
    SELECT 1 FROM memberships o WHERE o.org_id = m.org_id AND o.role = 'owner'
  )
),
first_admin AS (
  SELECT DISTINCT ON (m.org_id) m.org_id, m.user_id
  FROM memberships m
  JOIN ownerless ol ON ol.org_id = m.org_id
  WHERE m.role = 'admin'
  ORDER BY m.org_id, m.user_id ASC
)
UPDATE memberships m
SET role = 'owner'
FROM first_admin fa
WHERE m.org_id = fa.org_id AND m.user_id = fa.user_id;
