-- Role and user management — raw SQL (MySQL / TiDB)
--
-- Equivalent of `npm run roles` (scripts/roles.ts). Prefer the CLI or the in-app
-- Access control page: both write the audit trail and enforce the guards that this
-- file cannot (last-owner protection, 20-character reason, property-scope checks).
--
-- Two role columns, and they do different jobs:
--   users.operationalRole            drives the sidebar (client/src/lib/roleNavigation.ts)
--   entityMemberships.operationalRole drives data access per company (server/authz.ts)
-- Keep them in step, or a user sees a menu entry that then refuses to load.
--
-- PASSWORDS CANNOT BE SET HERE. localAuthCredentials.passwordHash is
-- scrypt (N=16384, r=8, p=1, keylen=64) in the format
--   scrypt$16384$8$1$<salt hex>$<key hex>
-- MySQL has no scrypt. After inserting a user, set the password with:
--   npm run roles -- create-user --email <e> --name "<n>" --role <role> --entity <id> --password "<pw>" --all-properties
-- Run against the same email and it updates the existing row instead of creating one.


-- ============================================================ READ

-- 1. The role list, straight from the enum definition.
SHOW COLUMNS FROM users LIKE 'operationalRole';
SHOW COLUMNS FROM entityMemberships LIKE 'operationalRole';
-- users:             platform_admin, owner, registered_manager, support_worker, hr_compliance, finance, read_only
-- entityMemberships: the same minus platform_admin (that one is workspace-wide only)


-- 2. Every user with their workspace role, company role and property scope.
SELECT u.id,
       u.email,
       u.operationalRole            AS workspaceRole,
       u.accountStatus,
       e.name                       AS company,
       m.operationalRole            AS companyRole,
       m.status                     AS membership,
       IF(m.allProperties = 1,
          'all properties',
          COALESCE(GROUP_CONCAT(p.name ORDER BY p.id SEPARATOR ', '), 'none')) AS propertyScope,
       m.extraCapabilities
FROM users u
LEFT JOIN entityMemberships   m  ON m.userId = u.id
LEFT JOIN entities            e  ON e.id = m.entityId
LEFT JOIN propertyAssignments pa ON pa.userId = u.id AND pa.entityId = m.entityId
LEFT JOIN properties          p  ON p.id = pa.propertyId
GROUP BY u.id, u.email, u.operationalRole, u.accountStatus,
         e.name, m.operationalRole, m.status, m.allProperties, m.extraCapabilities
ORDER BY u.id;


-- 3. Role headcount for one company.
SELECT m.operationalRole        AS role,
       COUNT(*)                 AS members,
       SUM(m.status = 'active') AS active,
       SUM(m.allProperties = 1) AS allProperties
FROM entityMemberships m
WHERE m.entityId = 1
GROUP BY m.operationalRole
ORDER BY members DESC;


-- 4. Who can reach a given property.
SELECT u.id, u.email, m.operationalRole AS role, pa.assignmentType
FROM entityMemberships m
JOIN users u ON u.id = m.userId
LEFT JOIN propertyAssignments pa ON pa.userId = u.id AND pa.propertyId = 7
WHERE m.entityId = 1
  AND m.status = 'active'
  AND (m.allProperties = 1 OR pa.id IS NOT NULL)
ORDER BY role, u.id;


-- 5. Companies and properties, to get the ids the writes below need.
SELECT id, name, status FROM entities ORDER BY id;
SELECT id, name, addressLine1, status FROM properties WHERE entityId = 1 ORDER BY id;


-- 6. Audit trail of role changes.
SELECT FROM_UNIXTIME(a.occurredAt / 1000)                        AS changedAt,
       a.action,
       a.actorUserId,
       JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.targetUserId'))  AS targetUserId,
       JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.previousRole'))  AS fromRole,
       JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.role'))          AS toRole,
       JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.reason'))        AS reason
FROM auditLogs a
WHERE a.action LIKE 'access_control.member.%'
ORDER BY a.id DESC
LIMIT 50;


-- ============================================================ WRITE
-- Wrap each block in START TRANSACTION / COMMIT. Check the SELECT after it before you commit.

-- 7. Create a user. No password yet — see the note at the top.
START TRANSACTION;

INSERT INTO users (openId, name, email, loginMethod, role, operationalRole, accountStatus)
VALUES (CONCAT('local_', REPLACE(UUID(), '-', '')),
        'Jane Doe',
        'jane@provider.co.uk',
        'email',
        'user',            -- 'admin' only for owner / platform_admin
        'support_worker',
        'active');

SET @userId   = LAST_INSERT_ID();
SET @entityId = 1;

-- Company membership. allProperties = 1 means every property; owner must always be 1.
INSERT INTO entityMemberships (entityId, userId, operationalRole, allProperties, extraCapabilities, status, createdBy)
VALUES (@entityId, @userId, 'support_worker', 0, JSON_ARRAY(), 'active', 1)
ON DUPLICATE KEY UPDATE operationalRole   = VALUES(operationalRole),
                        allProperties     = VALUES(allProperties),
                        extraCapabilities = VALUES(extraCapabilities),
                        status            = 'active',
                        endsAt            = NULL;

-- Property scope, only when allProperties = 0. One row per property.
-- assignmentType by role: registered_manager->manager, support_worker->worker,
-- hr_compliance->compliance, finance->finance, everything else->viewer.
INSERT INTO propertyAssignments (entityId, propertyId, userId, assignmentType, startsAt, createdBy)
VALUES (@entityId, 7, @userId, 'worker', UNIX_TIMESTAMP(NOW(3)) * 1000, 1),
       (@entityId, 8, @userId, 'worker', UNIX_TIMESTAMP(NOW(3)) * 1000, 1)
ON DUPLICATE KEY UPDATE startsAt = VALUES(startsAt), endsAt = NULL;

COMMIT;


-- 8. Change someone's role. Check the last-owner guard first — this SQL will not stop you
-- stranding a company with no administrator.
SELECT COUNT(*) AS activeOwners
FROM entityMemberships
WHERE entityId = 1 AND operationalRole = 'owner' AND status = 'active';

START TRANSACTION;
SET @userId   = (SELECT id FROM users WHERE email = 'jane@provider.co.uk');
SET @entityId = 1;
SET @role     = 'registered_manager';

UPDATE entityMemberships
SET operationalRole   = @role,
    allProperties     = IF(@role = 'owner', 1, 1),   -- second 1 = grant all properties
    extraCapabilities = IF(@role = 'owner', JSON_ARRAY(), JSON_ARRAY('compliance.read'))
WHERE entityId = @entityId AND userId = @userId;

UPDATE users
SET operationalRole = @role,
    role            = IF(@role IN ('owner', 'platform_admin'), 'admin', 'user')
WHERE id = @userId;

-- allProperties = 1 makes per-property rows meaningless, so clear them.
DELETE FROM propertyAssignments WHERE entityId = @entityId AND userId = @userId;
COMMIT;


-- 9. Grant extra capabilities on top of a role. Only these eight are grantable:
-- pack.read, pack.write, compliance.read, compliance.write,
-- document.read, document.write, supervision.read, staff.self_service
UPDATE entityMemberships
SET extraCapabilities = JSON_ARRAY('compliance.read', 'document.write')
WHERE entityId = 1 AND userId = (SELECT id FROM users WHERE email = 'jane@provider.co.uk');


-- 10. Remove access. Suspend, never DELETE: auditLogs is hash-chained and references
-- actorUserId, so removing a user row breaks the chain.
START TRANSACTION;
SET @userId = (SELECT id FROM users WHERE email = 'jane@provider.co.uk');

-- One company only:
UPDATE entityMemberships
SET status = 'ended', endsAt = UNIX_TIMESTAMP(NOW(3)) * 1000
WHERE userId = @userId AND entityId = 1;
DELETE FROM propertyAssignments WHERE userId = @userId AND entityId = 1;

-- Or the whole account:
-- UPDATE entityMemberships SET status = 'ended', endsAt = UNIX_TIMESTAMP(NOW(3)) * 1000 WHERE userId = @userId;
-- DELETE FROM propertyAssignments WHERE userId = @userId;
-- UPDATE users SET accountStatus = 'suspended' WHERE id = @userId;
COMMIT;


-- 11. Force a password change at next sign-in (the hash itself stays put).
UPDATE localAuthCredentials
SET mustChangePassword = 1
WHERE userId = (SELECT id FROM users WHERE email = 'jane@provider.co.uk');


-- ============================================================ ROLE -> PAGES
-- Navigation lives in client/src/lib/roleNavigation.ts, not in the database. Reference copy:
--
--   platform_admin     all 22 pages, plus /superadmin
--   owner              all 22 pages
--   registered_manager 19 — all except /access-control, /rota-controls, /nominated-individual
--   hr_compliance      12 — / /properties /workforce /staff /rota /compliance-dashboard
--                           /compliance /governance /documents /assurance /quality-reviews /regulation-28
--   read_only           7 — / /properties /workforce /rota /compliance-dashboard /compliance /documents
--   finance             6 — / /properties /compliance-dashboard /compliance /finance /documents
--   support_worker      4 — /keyworker-app /properties /care /staff
--
-- Live version:  npm run roles -- pages <role>
