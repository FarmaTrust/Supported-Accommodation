<?php
declare(strict_types=1);

namespace Hub;

/**
 * The tamper-evident audit trail, mirroring server/services/audit.ts.
 *
 * Every event stores sha256(JSON.stringify(envelope)) and the hash of the event
 * before it, so removing or editing a row breaks the chain. That only holds if
 * this runtime produces byte-identical JSON to the Node one, which needs two
 * things PHP does not do by default:
 *
 *   - JSON_UNESCAPED_SLASHES, because PHP writes "\/" where JSON.stringify
 *     writes "/";
 *   - JSON_UNESCAPED_UNICODE, because PHP writes "é" where JSON.stringify
 *     writes the character itself.
 *
 * Key order is part of the hash too. buildEnvelope() therefore inserts keys in
 * the same order as the JavaScript object literal: occurredAt, previousHash,
 * then the caller's fields, with metadata last unless the caller already placed
 * it. php/tests/run.php checks a real Node-produced hash against this code.
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
        // JavaScript keeps a key at its first position when it is reassigned, so
        // metadata only moves to the end when the caller never supplied it.
        if (!array_key_exists('metadata', $input)) {
            $hashPayload['metadata'] = null;
        } else {
            $hashPayload['metadata'] = $input['metadata'] ?? null;
        }

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
     * The read of the previous hash and the insert run inside one transaction
     * with the last row locked FOR UPDATE, because two concurrent writers that
     * both read the same previous hash would produce a fork the verifier reports
     * as tampering.
     *
     * @param array<string, mixed> $input
     */
    public static function write(array $input): void
    {
        $connection = Db::conn();
        $startedHere = !$connection->inTransaction();
        if ($startedHere) {
            $connection->beginTransaction();
        }

        try {
            $latest = Db::first('SELECT eventHash FROM auditLogs ORDER BY id DESC LIMIT 1 FOR UPDATE');
            $previousHash = $latest['eventHash'] ?? null;
            $occurredAt = LocalAuth::nowMs();
            $envelope = self::buildEnvelope($input, $previousHash, $occurredAt);

            Db::run(
                'INSERT INTO auditLogs
                    (occurredAt, actorUserId, actorType, entityId, propertyId, action, resourceType,
                     resourceId, sensitivity, result, reasonCode, correlationId, metadata, previousHash, eventHash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $envelope['occurredAt'],
                    $envelope['actorUserId'],
                    $envelope['actorType'],
                    $envelope['entityId'],
                    $envelope['propertyId'],
                    $envelope['action'],
                    $envelope['resourceType'],
                    $envelope['resourceId'],
                    $envelope['sensitivity'],
                    $envelope['result'],
                    $envelope['reasonCode'],
                    $envelope['correlationId'],
                    isset($input['metadata']) ? json_encode($input['metadata'], self::JSON_FLAGS) : null,
                    $envelope['previousHash'],
                    $envelope['eventHash'],
                ]
            );

            if ($startedHere) {
                $connection->commit();
            }
        } catch (\Throwable $error) {
            if ($startedHere && $connection->inTransaction()) {
                $connection->rollBack();
            }
            throw $error;
        }
    }
}
