<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The rules for accepting work a device did while it had no signal, mirroring
 * server/services/offlineSyncRules.ts.
 *
 * A queued draft is a claim about what happened at a time this server did not
 * witness. It is accepted only when the device's own clock is plausible, the
 * draft is inside the 48-hour window, the placement is still one that may be
 * recorded against, and the placement has not changed since the draft began. A
 * draft that fails any of those is held as a conflict for a person to look at,
 * never silently applied.
 */
final class OfflineSyncRules
{
    public const SCHEMA_VERSION = 1;

    private const MAX_OFFLINE_AGE_MS = 172800000;

    private const MAX_CLOCK_SKEW_MS = 300000;

    /** Placement states in which a key worker may still record. */
    private const RECORDABLE_STATUSES = ['active', 'notice'];

    /**
     * A hash that does not depend on key order, so the same content queued twice
     * hashes the same and a reused key carrying different content does not.
     */
    public static function payloadHash(mixed $value): string
    {
        return hash('sha256', self::canonical($value));
    }

    private static function canonical(mixed $value): string
    {
        if (!is_array($value)) {
            return (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }

        if (array_is_list($value)) {
            return '[' . implode(',', array_map(self::canonical(...), $value)) . ']';
        }

        // Keys are sorted, matching the Node implementation's localeCompare over
        // the plain ASCII keys these payloads use.
        ksort($value, SORT_STRING);

        $parts = [];
        foreach ($value as $key => $item) {
            $parts[] = json_encode((string) $key, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
                . ':' . self::canonical($item);
        }

        return '{' . implode(',', $parts) . '}';
    }

    /**
     * The reason this draft cannot be applied, or null when it can.
     *
     * @return array{code: string, message: string}|null
     */
    public static function assessEnvelope(
        int $clientVersion,
        int $clientCreatedAt,
        int $expiresAt,
        int $basePlacementUpdatedAt,
        int $placementUpdatedAt,
        string $placementStatus,
        int $now,
    ): ?array {
        if ($clientVersion !== self::SCHEMA_VERSION) {
            return ['code' => 'unsupported_version', 'message' => 'This device draft uses an unsupported format. Review and recreate it.'];
        }

        // A device whose clock is ahead could otherwise backdate or future-date
        // a safeguarding record.
        if ($clientCreatedAt > $now + self::MAX_CLOCK_SKEW_MS) {
            return ['code' => 'device_clock_invalid', 'message' => 'The device clock is too far ahead. Correct it before synchronising.'];
        }

        if ($expiresAt > $clientCreatedAt + self::MAX_OFFLINE_AGE_MS) {
            return ['code' => 'expiry_invalid', 'message' => 'The offline expiry exceeds the permitted 48-hour window.'];
        }

        if ($expiresAt <= $now || $clientCreatedAt < $now - self::MAX_OFFLINE_AGE_MS) {
            return ['code' => 'draft_expired', 'message' => 'This offline draft expired and must be reviewed before a new submission is created.'];
        }

        if (!in_array($placementStatus, self::RECORDABLE_STATUSES, true)) {
            return ['code' => 'placement_inactive', 'message' => 'The placement is no longer active for Key Worker recording.'];
        }

        // Something changed about the young person while the device was away, so
        // the draft was written against a record that has moved on.
        if ($placementUpdatedAt > $basePlacementUpdatedAt) {
            return ['code' => 'placement_changed', 'message' => 'Placement details changed after this draft began. Review the current record before re-queuing.'];
        }

        return null;
    }

    /** "new", "duplicate" — the same content again — or "key_reused". */
    public static function assessIdempotency(?string $existingHash, string $incomingHash): string
    {
        if ($existingHash === null) {
            return 'new';
        }

        return $existingHash === $incomingHash ? 'duplicate' : 'key_reused';
    }
}
