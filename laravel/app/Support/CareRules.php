<?php

declare(strict_types=1);

namespace App\Support;

/**
 * When a care record has to be escalated, mirroring
 * server/services/careRules.ts.
 *
 * Escalation is never purely the recording worker's judgement. A worker can ask
 * for one, but certain outcomes raise it whether or not they tick the box: a
 * reading outside the expected range, a missed medicine, a young person who did
 * not come home. Those are the cases where somebody senior has to know.
 */
final class CareRules
{
    private const MEDICATION_ESCALATION_OUTCOMES = ['refused', 'omitted', 'unavailable'];

    public static function healthEscalationRequired(string $outcome, bool $requested = false): bool
    {
        return $requested || $outcome === 'outside_expected';
    }

    public static function medicationEscalationRequired(string $outcome, bool $requested = false): bool
    {
        return $requested || in_array($outcome, self::MEDICATION_ESCALATION_OUTCOMES, true);
    }

    public static function curfewEscalationRequired(string $status, bool $requested = false): bool
    {
        return $requested || $status === 'absent';
    }

    /**
     * A medication record is signed off by a manager who did not write it, so
     * the same person cannot both give a medicine and certify that they did.
     */
    public static function canManagerAcknowledgeMedication(string $role, ?int $creatorId, int $actorId): bool
    {
        return in_array($role, ['owner', 'registered_manager'], true) && $creatorId !== $actorId;
    }

    public static function scheduledActivityNeedsAcknowledgement(bool $required, ?int $acknowledgedAt): bool
    {
        return $required && $acknowledgedAt === null;
    }
}
