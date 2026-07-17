-- Promote exactly one admin per org to owner: the admin with the smallest user_id.
-- Orgs with no admin are left unchanged. Runs after the enum value 'owner' was committed
-- in the earlier add_owner_role migration.
WITH first_admin AS (
  SELECT DISTINCT ON (org_id) org_id, user_id
  FROM memberships
  WHERE role = 'admin'
  ORDER BY org_id, user_id ASC
)
UPDATE memberships m
SET role = 'owner'
FROM first_admin fa
WHERE m.org_id = fa.org_id AND m.user_id = fa.user_id;
