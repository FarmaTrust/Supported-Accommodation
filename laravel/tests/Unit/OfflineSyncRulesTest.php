<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\OfflineSyncRules;
use PHPUnit\Framework\TestCase;

/**
 * A queued draft is a claim about something this server did not witness. These
 * check the conditions under which that claim is accepted — and that a draft
 * failing any of them is reported as a conflict for a person to look at rather
 * than quietly applied.
 */
final class OfflineSyncRulesTest extends TestCase
{
    private const NOW = 1789000000000;
    private const HOUR = 3600000;

    /** @return array{code: string, message: string}|null */
    private function assess(array $overrides = []): ?array
    {
        $clientCreatedAt = $overrides['clientCreatedAt'] ?? self::NOW - self::HOUR;

        return OfflineSyncRules::assessEnvelope(
            $overrides['clientVersion'] ?? OfflineSyncRules::SCHEMA_VERSION,
            $clientCreatedAt,
            $overrides['expiresAt'] ?? $clientCreatedAt + 12 * self::HOUR,
            $overrides['basePlacementUpdatedAt'] ?? self::NOW - 2 * self::HOUR,
            $overrides['placementUpdatedAt'] ?? self::NOW - 2 * self::HOUR,
            $overrides['placementStatus'] ?? 'active',
            self::NOW,
        );
    }

    public function test_a_well_formed_recent_draft_is_accepted(): void
    {
        $this->assertNull($this->assess());
        // A placement on notice is still one a key worker records against.
        $this->assertNull($this->assess(['placementStatus' => 'notice']));
    }

    public function test_a_draft_from_an_unknown_client_version_is_refused(): void
    {
        $this->assertSame('unsupported_version', $this->assess(['clientVersion' => 2])['code']);
    }

    public function test_a_device_clock_running_ahead_is_refused(): void
    {
        // Five minutes of skew is tolerated; an hour is not, or a device could
        // future-date a safeguarding record.
        $this->assertNull($this->assess(['clientCreatedAt' => self::NOW + 4 * 60000]));
        $this->assertSame('device_clock_invalid', $this->assess(['clientCreatedAt' => self::NOW + self::HOUR])['code']);
    }

    public function test_the_offline_window_cannot_be_stretched_by_the_device(): void
    {
        $created = self::NOW - self::HOUR;

        $this->assertSame(
            'expiry_invalid',
            $this->assess(['clientCreatedAt' => $created, 'expiresAt' => $created + 49 * self::HOUR])['code'],
        );
    }

    public function test_an_expired_draft_is_held_for_review(): void
    {
        $this->assertSame('draft_expired', $this->assess(['expiresAt' => self::NOW - 1])['code']);
        $this->assertSame(
            'draft_expired',
            $this->assess(['clientCreatedAt' => self::NOW - 49 * self::HOUR])['code'],
        );
    }

    public function test_a_closed_placement_cannot_be_recorded_against(): void
    {
        $this->assertSame('placement_inactive', $this->assess(['placementStatus' => 'ended'])['code']);
    }

    public function test_a_placement_that_moved_on_stops_the_draft(): void
    {
        $this->assertSame(
            'placement_changed',
            $this->assess([
                'basePlacementUpdatedAt' => self::NOW - 3 * self::HOUR,
                'placementUpdatedAt' => self::NOW - 1,
            ])['code'],
        );
    }

    public function test_the_payload_hash_ignores_key_order_but_not_content(): void
    {
        $left = OfflineSyncRules::payloadHash(['b' => 2, 'a' => ['y' => 1, 'x' => [3, 4]]]);
        $right = OfflineSyncRules::payloadHash(['a' => ['x' => [3, 4], 'y' => 1], 'b' => 2]);

        $this->assertSame($left, $right);
        // List order is content, not ordering noise.
        $this->assertNotSame($left, OfflineSyncRules::payloadHash(['a' => ['x' => [4, 3], 'y' => 1], 'b' => 2]));
        $this->assertNotSame($left, OfflineSyncRules::payloadHash(['b' => 3, 'a' => ['y' => 1, 'x' => [3, 4]]]));
    }

    public function test_the_same_key_with_different_content_is_a_reuse_not_a_retry(): void
    {
        $this->assertSame('new', OfflineSyncRules::assessIdempotency(null, 'abc'));
        $this->assertSame('duplicate', OfflineSyncRules::assessIdempotency('abc', 'abc'));
        $this->assertSame('key_reused', OfflineSyncRules::assessIdempotency('abc', 'def'));
    }
}
