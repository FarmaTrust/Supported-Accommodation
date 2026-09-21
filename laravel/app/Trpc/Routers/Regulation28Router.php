<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\AssuranceRules;
use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EncryptedFields;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * regulation28.*, mirroring server/routers/regulation28.ts.
 *
 * Telling the host local authority when a child is placed in, or leaves, their
 * area. The duty is on the placing provider and the clock is 24 hours from the
 * event, so the due date is set when the notification is raised rather than
 * entered by hand.
 *
 * Every notification goes through three steps in order: raise it, record the
 * routing decision with the facts that were shared, then record that it was
 * sent. Submission cannot jump the decision, and a live processing restriction
 * on the young person's record stops it outright.
 */
final class Regulation28Router
{
    private const NOTIFICATION_DUE_MS = 86400000;

    private const NOTIFICATION_TYPES = ['admission', 'discharge'];
    private const DISCHARGE_DESTINATIONS = [
        'family', 'independent_living', 'supported_accommodation', 'semi_independent',
        'custody', 'hospital', 'homeless', 'unknown', 'other',
    ];
    private const DISCHARGE_REASONS = [
        'planned_transition', 'placement_end', 'safeguarding', 'placement_breakdown',
        'custody', 'hospital', 'young_person_choice', 'other',
    ];
    private const DECISIONS = ['notify_host_authority', 'same_authority_exempt', 'not_required'];
    private const SUBMISSION_METHODS = ['email', 'portal', 'secure_link', 'post', 'other'];

    public static function register(Registry $registry): void
    {
        $registry->query('regulation28.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'young_person.read');

            return [
                'placements' => $propertyIds === [] ? [] : DB::table('placements as pl')
                    ->join('youngPeople as yp', 'yp.id', '=', 'pl.youngPersonId')
                    ->leftJoin('properties as pr', 'pr.id', '=', 'pl.propertyId')
                    ->where('pl.entityId', $entityId)
                    ->whereIn('pl.propertyId', $propertyIds)
                    ->select([
                        'pl.id', 'pl.propertyId', 'pl.status', 'yp.reference',
                        'pr.name as propertyName', 'pl.localAuthorityId',
                    ])->get()->map(static fn ($r) => (array) $r)->all(),
                // Node shipped the raw ciphertext columns to the browser, which
                // the client never reads. They are dropped instead: sending
                // encrypted bytes nobody decrypts is exposure with no purpose.
                'notifications' => $propertyIds === [] ? [] : EncryptedFields::revealAll(
                    DB::table('placementNotifications')
                        ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)
                        ->orderByDesc('dueAt')->get(),
                    [],
                ),
                'authorities' => DB::table('localAuthorities')->where('entityId', $entityId)
                    ->get(['id', 'name', 'placementEmail'])->map(static fn ($r) => (array) $r)->all(),
            ];
        });

        $registry->mutation('regulation28.create', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');

            $scope = Authz::assertPlacementCapability($ctx->userId(), $placementId, 'young_person.write');
            $placement = $scope['placement'];

            if ((int) $placement['entityId'] !== $entityId || $placement['propertyId'] === null) {
                throw TrpcException::badRequest('Placement scope is incomplete');
            }

            $notificationType = Validate::enum($input['notificationType'] ?? null, self::NOTIFICATION_TYPES, 'notificationType');
            $destination = Validate::optionalEnum($input['dischargeDestinationType'] ?? null, self::DISCHARGE_DESTINATIONS, 'dischargeDestinationType');
            $dischargeReason = Validate::optionalEnum($input['dischargeReason'] ?? null, self::DISCHARGE_REASONS, 'dischargeReason');

            // Where a child went and why is the whole point of a discharge
            // notification, so it cannot be raised without them.
            if ($notificationType === 'discharge' && ($destination === null || $dischargeReason === null)) {
                throw TrpcException::badRequest('Discharge destination and reason are required');
            }

            $eventAt = Validate::int($input['eventAt'] ?? null, 'eventAt');

            $id = (int) DB::table('placementNotifications')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'propertyId' => (int) $placement['propertyId'],
                'notificationType' => $notificationType,
                'eventAt' => $eventAt,
                // 24 hours from the event itself, not from when somebody got
                // round to opening the form.
                'dueAt' => $eventAt + self::NOTIFICATION_DUE_MS,
                'placingAuthorityId' => $placement['localAuthorityId'] === null ? null : (int) $placement['localAuthorityId'],
                'dischargeDestinationType' => $destination,
                'dischargeReason' => $dischargeReason,
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $id];
        });

        $registry->mutation('regulation28.recordDecision', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $row] = self::notificationForWrite($ctx, $input);

            $decision = Validate::enum($input['decision'] ?? null, self::DECISIONS, 'decision');
            $recipientEmail = ($input['recipientEmail'] ?? null) === null
                ? null
                : Validate::email($input['recipientEmail'], 'recipientEmail');

            DB::table('placementNotifications')->where('id', $row->id)->update([
                'decision' => $decision,
                'decisionReason' => Validate::string($input['decisionReason'] ?? null, 'decisionReason', 10, 4000),
                'hostAuthorityId' => Validate::optionalId($input['hostAuthorityId'] ?? null, 'hostAuthorityId'),
                'recipientName' => Validate::optionalString($input['recipientName'] ?? null, 'recipientName', 220),
                'recipientEmail' => $recipientEmail,
                // The facts are snapshotted at the decision, so the record shows
                // what was shared rather than what the placement says today.
                'factsSnapshotCiphertext' => EncryptedFields::seal(
                    Validate::string($input['factsSnapshot'] ?? null, 'factsSnapshot', 20, 10000),
                ),
                'dischargeDetailsCiphertext' => EncryptedFields::seal(
                    Validate::optionalString($input['dischargeDetails'] ?? null, 'dischargeDetails', 8000),
                ),
                // A notification that is not needed still ends in a recorded
                // decision, which is what an inspector asks to see.
                'status' => AssuranceRules::notificationStatusForDecision($decision),
                'decisionBy' => $ctx->userId(),
                'decisionAt' => Dates::nowMillis(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                'action' => "reg28.{$row->notificationType}.decision",
                'resourceType' => 'placement_notification',
                'resourceId' => (int) $row->id,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => ['decision' => $decision],
            ]);

            return ['success' => true];
        });

        $registry->mutation('regulation28.submit', Registry::USER, static function (Context $ctx, mixed $input): array {
            [$entityId, $row] = self::notificationForWrite($ctx, $input);

            if (!in_array($row->status, ['decision_recorded', 'pack_ready'], true)) {
                throw TrpcException::badRequest('Record the routing decision before submission');
            }

            $restrictions = [];
            foreach (DB::table('processingRestrictions')
                ->where('placementId', $row->placementId)
                ->whereIn('status', ['active', 'review_due'])
                ->get(['restrictionType', 'status']) as $restriction) {
                $restrictions[] = [
                    'restrictionType' => (string) $restriction->restrictionType,
                    'status' => (string) $restriction->status,
                ];
            }

            // A restriction on the young person's record outranks the
            // notification duty: the answer is to lift it, not to send anyway.
            if (AssuranceRules::blocksSharing($restrictions)) {
                throw TrpcException::forbidden('An active processing or sharing restriction blocks submission');
            }

            DB::table('placementNotifications')->where('id', $row->id)->update([
                'status' => 'submitted',
                'submittedAt' => Dates::nowMillis(),
                'submittedBy' => $ctx->userId(),
                'submissionMethod' => Validate::enum($input['submissionMethod'] ?? null, self::SUBMISSION_METHODS, 'submissionMethod'),
                'submissionReference' => Validate::optionalString($input['submissionReference'] ?? null, 'submissionReference', 180),
                'submissionEvidenceDocumentId' => Validate::optionalId(
                    $input['submissionEvidenceDocumentId'] ?? null, 'submissionEvidenceDocumentId',
                ),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                'action' => "reg28.{$row->notificationType}.submitted",
                'resourceType' => 'placement_notification',
                'resourceId' => (int) $row->id,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
            ]);

            return ['success' => true];
        });
    }

    /**
     * The notification named in the request, with the placement check that goes
     * with it: reaching the notification means reaching the young person.
     *
     * @return array{0: int, 1: object}
     */
    private static function notificationForWrite(Context $ctx, mixed $input): array
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        $notificationId = Validate::id($input['notificationId'] ?? null, 'notificationId');

        $row = DB::table('placementNotifications')
            ->where('id', $notificationId)->where('entityId', $entityId)->first();

        if ($row === null) {
            throw TrpcException::notFound('Placement notification not found');
        }

        Authz::assertPlacementCapability($ctx->userId(), (int) $row->placementId, 'young_person.write');

        return [$entityId, $row];
    }
}
