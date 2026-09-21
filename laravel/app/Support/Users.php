<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * User lookup and role resolution, mirroring server/services/roleResolution.ts.
 *
 * users.roleId is the only role column on the table. Everything downstream reads
 * operationalRole and role, so those are derived here once from the roles row
 * rather than in every permission gate.
 *
 * The query builder is used rather than Eloquent models: there are 144 tables,
 * and a model class per table would be a few thousand lines of scaffolding that
 * buys nothing here, where the reads are explicit and the writes are audited.
 */
final class Users
{
    /**
     * Built-in roles never change at runtime. They are read once per request and
     * held here, which takes one query out of every authenticated call.
     *
     * @var array<int, array<string, mixed>>|null
     */
    private static ?array $builtInRoles = null;

    public static function resetRoleCache(): void
    {
        self::$builtInRoles = null;
    }

    /** @return array<string, mixed>|null */
    public static function byOpenId(string $openId): ?array
    {
        $row = DB::table('users')->where('openId', $openId)->first();

        return $row === null ? null : (array) $row;
    }

    /** @return array<string, mixed>|null */
    public static function byId(int $id): ?array
    {
        $row = DB::table('users')->where('id', $id)->first();

        return $row === null ? null : (array) $row;
    }

    /**
     * Email lookup is case-insensitive: addresses are stored as entered but
     * always compared normalised, the same way localAuthCredentials does it.
     *
     * @return array<string, mixed>|null
     */
    public static function byEmail(string $email): ?array
    {
        $row = DB::table('users')
            ->whereRaw('LOWER(email) = ?', [LocalAuth::normaliseEmail($email)])
            ->first();

        return $row === null ? null : (array) $row;
    }

    /** @return array<string, mixed>|null */
    public static function role(int $roleId): ?array
    {
        if (self::$builtInRoles === null) {
            self::$builtInRoles = [];
            $rows = DB::table('roles')->where('isBuiltIn', 1)->whereNull('entityId')->get();
            foreach ($rows as $row) {
                self::$builtInRoles[(int) $row->id] = (array) $row;
            }
        }

        if (isset(self::$builtInRoles[$roleId])) {
            return self::$builtInRoles[$roleId];
        }

        $row = DB::table('roles')->where('id', $roleId)->first();

        return $row === null ? null : (array) $row;
    }

    /**
     * Attaches the derived role fields the rest of the application reads.
     *
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    public static function withResolvedRole(array $user): array
    {
        $role = self::role((int) $user['roleId']);

        if ($role === null) {
            // A user whose role row vanished must not quietly fall back to a
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

    public static function builtInRoleId(string $slug): int
    {
        $role = DB::table('roles')
            ->where('isBuiltIn', 1)
            ->whereNull('entityId')
            ->where('slug', $slug)
            ->first();

        if ($role === null) {
            throw new \RuntimeException("The built-in \"$slug\" role is missing. Run the database migrations.");
        }

        return (int) $role->id;
    }

    /**
     * The client shape of a user. phone and phoneCapturedAt are stripped for the
     * same reason server/routers.ts strips them: they are collected at first
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
                $safe[$column] = Dates::fromDatabase($safe[$column]);
            }
        }

        return $safe;
    }
}
