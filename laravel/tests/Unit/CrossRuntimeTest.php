<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\Audit;
use App\Support\Crypto;
use App\Support\Jwt;
use App\Support\Superjson;
use DateTimeImmutable;
use DateTimeInterface;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use stdClass;

/**
 * The three formats that had to stay byte-identical to the Node runtime.
 *
 * node-fixture.json was captured from the Node sources while they still
 * existed, audit hashes included, from the production buildAuditEnvelope. The
 * generator went with the Node server; the fixture stays as a frozen reference.
 *
 * It still earns its place. The session cookies, the encrypted columns and
 * above all the audit chain in the production database were written by that
 * runtime, and this runtime has to keep reading and extending them. These fail
 * if PHP ever drifts from the format those rows are in, rather than the chain
 * quietly forking from the day of the cutover.
 */
final class CrossRuntimeTest extends TestCase
{
    /** @return array<string, mixed> */
    private function fixture(): array
    {
        $path = dirname(__DIR__) . '/fixtures/node-fixture.json';
        if (!is_file($path)) {
            $this->markTestSkipped("No fixture at $path. Run: npx tsx laravel/tests/fixtures/make-fixture.ts > laravel/tests/fixtures/node-fixture.json");
        }

        return json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    }

    private const SECRET = 'test-secret-value-1234567890';

    public function test_plain_values_carry_no_meta(): void
    {
        $encoded = Superjson::encode(['id' => 7, 'ok' => true, 'tags' => ['a', 'b']]);

        $this->assertSame(['json' => ['id' => 7, 'ok' => true, 'tags' => ['a', 'b']]], $encoded);
    }

    public function test_dates_encode_with_milliseconds_and_meta(): void
    {
        $encoded = Superjson::encode(['at' => new DateTimeImmutable('2026-02-03T04:05:06.789Z')]);

        $this->assertSame('2026-02-03T04:05:06.789Z', $encoded['json']['at']);
        $this->assertSame(['Date'], $encoded['meta']['values']['at']);
    }

    public function test_a_root_level_date_uses_the_dot_path(): void
    {
        $encoded = Superjson::encode(new DateTimeImmutable('2020-01-01T00:00:00Z'));

        $this->assertSame(['Date'], $encoded['meta']['values']['.']);
    }

    public function test_dates_survive_a_round_trip(): void
    {
        $decoded = Superjson::decode(Superjson::encode(['at' => new DateTimeImmutable('2026-02-03T04:05:06.789Z')]));

        $this->assertInstanceOf(DateTimeInterface::class, $decoded['at']);
        $this->assertSame('2026-02-03T04:05:06.789Z', $decoded['at']->format('Y-m-d\TH:i:s.v\Z'));
    }

    public function test_an_unsupported_object_is_rejected_rather_than_shipped(): void
    {
        $this->expectException(InvalidArgumentException::class);

        Superjson::encode(['bad' => new stdClass()]);
    }

    public function test_an_unknown_meta_path_is_ignored(): void
    {
        $decoded = Superjson::decode(['json' => ['a' => 1], 'meta' => ['values' => ['nope.deep' => ['Date']]]]);

        $this->assertSame(['a' => 1], $decoded);
    }

    public function test_a_token_this_runtime_signed_verifies(): void
    {
        $token = Jwt::sign(['openId' => 'u1', 'authType' => 'local'], self::SECRET, time() + 3600);

        $this->assertSame('u1', Jwt::verify($token, self::SECRET)['openId']);
    }

    public function test_tokens_are_rejected_when_they_should_be(): void
    {
        $token = Jwt::sign(['openId' => 'u1'], self::SECRET, time() + 3600);

        $this->assertNull(Jwt::verify($token, 'a-different-secret'), 'wrong secret');
        $this->assertNull(Jwt::verify(Jwt::sign(['openId' => 'u1'], self::SECRET, time() - 1), self::SECRET), 'expired');
        $this->assertNull(Jwt::verify('not.a.token', self::SECRET), 'malformed');
        $this->assertNull(Jwt::verify('', self::SECRET), 'empty');

        $tampered = explode('.', $token);
        $tampered[1] = Jwt::base64UrlEncode('{"openId":"admin","authType":"local"}');
        $this->assertNull(Jwt::verify(implode('.', $tampered), self::SECRET), 'tampered payload');

        $noneAlg = Jwt::base64UrlEncode('{"alg":"none","typ":"JWT"}') . '.'
            . Jwt::base64UrlEncode('{"openId":"admin"}') . '.';
        $this->assertNull(Jwt::verify($noneAlg, self::SECRET), 'alg none');
    }

    public function test_a_token_signed_by_jose_verifies_here(): void
    {
        $fixture = $this->fixture();
        $claims = Jwt::verify($fixture['token'], self::SECRET);

        $this->assertIsArray($claims);
        $this->assertSame('u1', $claims['openId']);
        $this->assertSame('local', $claims['authType']);
        $this->assertSame(3, $claims['passwordVersion']);
    }

    public function test_a_jose_token_that_expired_is_rejected_here(): void
    {
        $this->assertNull(Jwt::verify($this->fixture()['expiredToken'], self::SECRET));
    }

    public function test_superjson_from_node_round_trips_byte_for_byte(): void
    {
        $fixture = $this->fixture();
        $decoded = Superjson::decode($fixture['superjson']);

        $this->assertInstanceOf(DateTimeInterface::class, $decoded['when']);
        $this->assertSame('2026-02-03T04:05:06.789Z', $decoded['when']->format('Y-m-d\TH:i:s.v\Z'));
        $this->assertInstanceOf(DateTimeInterface::class, $decoded['nested']['at']);

        $this->assertSame(
            json_encode($fixture['superjson']),
            json_encode(Superjson::encode($decoded)),
        );
    }

    public function test_a_value_encrypted_by_node_decrypts_here(): void
    {
        $fixture = $this->fixture();

        // Bank sort codes and account numbers already in the database were
        // written by the Node runtime. If this fails, moving traffic across
        // would make them unreadable.
        putenv('JWT_SECRET=' . $fixture['cryptoSecret']);
        $_ENV['JWT_SECRET'] = $fixture['cryptoSecret'];
        $_SERVER['JWT_SECRET'] = $fixture['cryptoSecret'];

        $this->assertSame($fixture['cryptoPlaintext'], Crypto::decrypt($fixture['cryptoCiphertext']));

        // And the other direction, so a value written here stays readable.
        $this->assertSame('98-76-54', Crypto::decrypt(Crypto::encrypt('98-76-54')));
    }

    public function test_a_tampered_ciphertext_is_refused_rather_than_altered(): void
    {
        $fixture = $this->fixture();
        putenv('JWT_SECRET=' . $fixture['cryptoSecret']);
        $_ENV['JWT_SECRET'] = $fixture['cryptoSecret'];
        $_SERVER['JWT_SECRET'] = $fixture['cryptoSecret'];

        $parts = explode('.', Crypto::encrypt('12345678'));
        // Flip the ciphertext; GCM's tag must catch it.
        $parts[2] = Jwt::base64UrlEncode(strrev(Jwt::base64UrlDecode($parts[2])));

        $this->expectException(RuntimeException::class);
        Crypto::decrypt(implode('.', $parts));
    }

    public function test_audit_hashes_match_the_node_implementation(): void
    {
        $fixture = $this->fixture();

        $noMeta = Audit::buildEnvelope($fixture['auditInput'], null, 1789000000000);
        $this->assertSame($fixture['auditNoMeta']['eventHash'], $noMeta['eventHash']);

        // Slashes and non-ASCII characters are where PHP's json_encode differs
        // from JSON.stringify, so the metadata here contains both.
        $withMetaInput = $fixture['auditInput'];
        $withMetaInput['metadata'] = ['path' => '/reports/a b', 'note' => 'café — naïve', 'count' => 3];
        $withMeta = Audit::buildEnvelope($withMetaInput, $noMeta['eventHash'], 1789000000001);

        $this->assertSame($fixture['auditWithMeta']['eventHash'], $withMeta['eventHash']);
        $this->assertSame($noMeta['eventHash'], $withMeta['previousHash']);
        $this->assertSame($fixture['auditWithMeta']['resourceId'], $withMeta['resourceId']);
        $this->assertSame($fixture['auditWithMeta']['sensitivity'], $withMeta['sensitivity']);
    }
}
