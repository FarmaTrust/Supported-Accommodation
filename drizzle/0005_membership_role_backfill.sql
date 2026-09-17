-- Every membership now points at a row in `roles`, so editing a built-in role reaches the people
-- who hold it. Memberships created before this table existed only carried the enum.
UPDATE `entityMemberships` m
JOIN `roles` r ON r.`isBuiltIn` = 1 AND r.`slug` = m.`operationalRole`
SET m.`roleId` = r.`id`
WHERE m.`roleId` IS NULL;
