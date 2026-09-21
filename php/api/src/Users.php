<?php
declare(strict_types=1);

namespace Hub;

/**
 * User lookup and role resolution, mirroring server/services/roleResolution.ts.
 *
 * users.roleId is the only role column on the table; everything downstream
 * reads operationalRole and role, so those are derived here once from the roles
 * row rather than in every permission gate.
 */
final class Users
{
    /** Built-in roles never change at runtime, so one request reads them once. */
    private static ?array $roleCache = null;

    /** @return array<string, mixed>|null */
    public static function byOpenId(string $openId): ?array
    {
        return Db::first('SELECT * FROM users WHERE openId = ? LIMIT 1', [$openId]);
    }

    /** @return array<string, mixed>|null */
    public static function byId(int $id): ?array
    {
        return Db::first('SELECT * FROM users WHERE id = ? LIMIT 1', [$id]);
    }

    /** @return array<string, mixed>|null */
    public static function role(int $roleId): ?array
    {
        if (self::$roleCache === null) {
            self::$roleCache = [];
            foreach (Db::all('SELECT * FROM roles WHERE isBuiltIn = 1 AND entityId IS NULL') as $row) {
                self::$roleCache[(int) $row['id']] = $row;
            }
        }

        return self::$roleCache[$roleId]
            ?? Db::first('SELECT * FROM roles WHERE id = ? LIMIT 1', [$roleId]);
    }

    /**
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    public static function withResolvedRole(array $user): array
    {
        $role = self::role((int) $user['roleId']);

        if ($role === null) {
            // A user whose role row vanished must not silently fall back to a
            // permissive default.
            return $user + [
                'operationalRole' => 'read_only',
                'role' => 'user',
                'roleName' => 'Unknown role',
                'roleSlug' => 'read_only',
                'isBuiltInRole' => false,
            ];
        }

        $isBuiltIn = (int) $role['isBuiltIn'] === 1;

        return $user + [
            // A custom role answers to its base role; a built-in role to itself.
            'operationalRole' => $isBuiltIn ? $role['slug'] : $role['baseRole'],
            'role' => (int) $role['isAdminAccount'] === 1 ? 'admin' : 'user',
            'roleName' => $role['name'],
            'roleSlug' => $role['slug'],
            'isBuiltInRole' => $isBuiltIn,
        ];
    }

    /**
     * The client shape of a user. phone and phoneCapturedAt are stripped for the
     * same reason server/routers.ts strips them: they are collected on first
     * login and never leave the account context.
     *
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    public static function toSafeUser(array $user): array
    {
        $safe = $user;
        unset($safe['phone'], $safe['phoneCapturedAt']);

        $safe['id'] = (int) $safe['id'];
        $safe['roleId'] = (int) $safe['roleId'];
        foreach (['createdAt', 'updatedAt', 'lastSignedIn'] as $column) {
            if (array_key_exists($column, $safe)) {
                $safe[$column] = Db::toDate(is_string($safe[$column]) ? $safe[$column] : null);
            }
        }

        return $safe;
    }
}
