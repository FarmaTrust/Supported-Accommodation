<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The tamper-evident audit trail, mirroring server/services/audit.ts.
 *
 * Every event stores sha256(JSON.stringify(envelope)) together with the hash of
 * the event before it, so removing or editing a row breaks the chain. That only
 * holds while this runtime produces byte-identical JSON to the Node one, which
 * needs two things PHP does not do by default:
 *
 *   - JSON_UNESCAPED_SLASHES, because PHP writes "\/" where JSON.stringify
 *     writes "/";
 *   - JSON_UNESCAPED_UNICODE, because PHP writes "é" where JSON.stringify
 *     writes the character itself.
 *
 * Key order is part of the hash too, so buildEnvelope() inserts keys in the same
 * order as the JavaScript object literal. tests/Feature/CrossRuntimeTest.php
 * checks this against hashes produced by the production buildAuditEnvelope.
 */
final class Audit
{
    private const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR;

    /** @param array<string, mixed> $payload */
    public static function hashEvent(array $payload): string
    {
        return hash('sha256', (string) json_encode($payload, self::JSON_FLAGS));
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public static function buildEnvelope(array $input, ?string $previousHash, int $occurredAt): array
    {
        $hashPayload = ['occurredAt' => $occurredAt, 'previousHash' => $previousHash] + $input;

        // JavaScript keeps a key at its original position when it is reassigned,
        // so metadata only moves to the end when the caller never supplied it.
        $hashPayload['metadata'] = $input['metadata'] ?? null;

        return [
            'occurredAt' => $occurredAt,
            'previousHash' => $previousHash,
            'eventHash' => self::hashEvent($hashPayload),
            'actorUserId' => $input['actorUserId'] ?? null,
            'actorType' => $input['actorType'] ?? 'user',
            'entityId' => $input['entityId'] ?? null,
            'propertyId' => $input['propertyId'] ?? null,
            'action' => $input['action'],
            'resourceType' => $input['resourceType'],
            'resourceId' => isset($input['resourceId']) ? (string) $input['resourceId'] : null,
            'sensitivity' => $input['sensitivity'] ?? 'general',
            'result' => $input['result'],
            'reasonCode' => $input['reasonCode'] ?? null,
            'correlationId' => $input['correlationId'] ?? null,
        ];
    }

    /**
     * Appends an event to the chain.
     *
     * Reading the previous hash and inserting run inside one transaction with
     * the last row locked, because two concurrent writers that both read the
     * same previous hash would produce a fork the verifier reports as tampering.
     *
     * @param array<string, mixed> $input
     */
    public static function write(array $input): void
    {
        $run = static function () use ($input): void {
            $latest = DB::table('auditLogs')->orderByDesc('id')->lockForUpdate()->first('eventHash');
            $previousHash = $latest->eventHash ?? null;
            $envelope = self::buildEnvelope($input, $previousHash, Dates::nowMillis());

            DB::table('auditLogs')->insert([
                'occurredAt' => $envelope['occurredAt'],
                'actorUserId' => $envelope['actorUserId'],
                'actorType' => $envelope['actorType'],
                'entityId' => $envelope['entityId'],
                'propertyId' => $envelope['propertyId'],
                'action' => $envelope['action'],
                'resourceType' => $envelope['resourceType'],
                'resourceId' => $envelope['resourceId'],
                'sensitivity' => $envelope['sensitivity'],
                'result' => $envelope['result'],
                'reasonCode' => $envelope['reasonCode'],
                'correlationId' => $envelope['correlationId'],
                'metadata' => isset($input['metadata'])
                    ? json_encode($input['metadata'], self::JSON_FLAGS)
                    : null,
                'previousHash' => $envelope['previousHash'],
                'eventHash' => $envelope['eventHash'],
            ]);
        };

        if (DB::transactionLevel() > 0) {
            $run();

            return;
        }

        DB::transaction($run);
    }

    /**
     * Walks the chain and reports the first link that does not match, which is
     * what the Assurance workspace surfaces.
     *
     * @return array{checked: int, intact: bool, brokenAtId: int|null}
     */
    public static function verifyChain(?int $limit = null): array
    {
        $query = DB::table('auditLogs')->orderBy('id')->select(['id', 'previousHash', 'eventHash']);
        if ($limit !== null) {
            $query->limit($limit);
        }

        $previous = null;
        $checked = 0;

        foreach ($query->cursor() as $row) {
            $checked++;
            if ($row->previousHash !== $previous) {
                return ['checked' => $checked, 'intact' => false, 'brokenAtId' => (int) $row->id];
            }
            $previous = $row->eventHash;
        }

        return ['checked' => $checked, 'intact' => true, 'brokenAtId' => null];
    }
}
