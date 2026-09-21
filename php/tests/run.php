<?php
declare(strict_types=1);

/**
 * Self-check for the pieces that have to agree byte-for-byte with the Node
 * server: the session token format and the superjson wire format. Run it with
 *
 *   php php/tests/run.php [path/to/fixture.json]
 *
 * The fixture is produced by php/tests/make-fixture.ts and holds real jose and
 * superjson output, so a change on either side shows up here rather than as a
 * blank screen in the browser.
 */

require __DIR__ . '/../api/src/Jwt.php';
require __DIR__ . '/../api/src/Superjson.php';
require __DIR__ . '/../api/src/Audit.php';

use Hub\Audit;
use Hub\Jwt;
use Hub\Superjson;

$failures = 0;
$checks = 0;

function check(string $label, bool $ok): void
{
    global $failures, $checks;
    $checks++;
    if (!$ok) {
        $failures++;
    }
    echo ($ok ? '  ok   ' : '  FAIL '), $label, "\n";
}

echo "superjson\n";

$encoded = Superjson::encode(['id' => 7, 'ok' => true, 'tags' => ['a', 'b']]);
check('plain values carry no meta', $encoded === ['json' => ['id' => 7, 'ok' => true, 'tags' => ['a', 'b']]]);

$withDate = Superjson::encode(['at' => new DateTimeImmutable('2026-02-03T04:05:06.789Z')]);
check('date encodes to ISO with ms', $withDate['json']['at'] === '2026-02-03T04:05:06.789Z');
check('date is annotated in meta', ($withDate['meta']['values']['at'] ?? null) === ['Date']);

$rootDate = Superjson::encode(new DateTimeImmutable('2020-01-01T00:00:00Z'));
check('root date uses "." path', ($rootDate['meta']['values']['.'] ?? null) === ['Date']);

$roundTrip = Superjson::decode(Superjson::encode(['at' => new DateTimeImmutable('2026-02-03T04:05:06.789Z')]));
check('date survives a round trip', $roundTrip['at'] instanceof DateTimeInterface
    && $roundTrip['at']->format('Y-m-d\TH:i:s.v\Z') === '2026-02-03T04:05:06.789Z');

check('bare value without envelope is passed through', Superjson::decode('plain') === 'plain');
check('unknown meta path is ignored', Superjson::decode(['json' => ['a' => 1], 'meta' => ['values' => ['nope.deep' => ['Date']]]]) === ['a' => 1]);

$threw = false;
try {
    Superjson::encode(['bad' => new stdClass()]);
} catch (InvalidArgumentException) {
    $threw = true;
}
check('unsupported object is rejected, not silently shipped', $threw);

echo "jwt\n";

$secret = 'test-secret-value-1234567890';
$token = Jwt::sign(['openId' => 'u1', 'authType' => 'local'], $secret, time() + 3600);
$claims = Jwt::verify($token, $secret);
check('self-signed token verifies', is_array($claims) && $claims['openId'] === 'u1');
check('wrong secret is rejected', Jwt::verify($token, 'other') === null);
check('expired token is rejected', Jwt::verify(Jwt::sign(['openId' => 'u1'], $secret, time() - 1), $secret) === null);
check('malformed token is rejected', Jwt::verify('not.a.token', $secret) === null);
check('empty token is rejected', Jwt::verify('', $secret) === null);

$tampered = explode('.', $token);
$tampered[1] = Jwt::base64UrlEncode('{"openId":"admin","authType":"local"}');
check('tampered payload is rejected', Jwt::verify(implode('.', $tampered), $secret) === null);

$noneAlg = Jwt::base64UrlEncode('{"alg":"none","typ":"JWT"}') . '.'
    . Jwt::base64UrlEncode('{"openId":"admin"}') . '.';
check('alg "none" is rejected', Jwt::verify($noneAlg, $secret) === null);

$fixturePath = $argv[1] ?? __DIR__ . '/fixture.json';
if (is_file($fixturePath)) {
    echo "cross-runtime (fixture from node)\n";
    $fixture = json_decode((string) file_get_contents($fixturePath), true, 512, JSON_THROW_ON_ERROR);

    $joseClaims = Jwt::verify($fixture['token'], $secret);
    check('jose-signed token verifies in php', is_array($joseClaims)
        && $joseClaims['openId'] === 'u1'
        && $joseClaims['authType'] === 'local'
        && $joseClaims['passwordVersion'] === 3);

    $decoded = Superjson::decode($fixture['superjson']);
    check('node superjson decodes to php dates', $decoded['when'] instanceof DateTimeInterface
        && $decoded['when']->format('Y-m-d\TH:i:s.v\Z') === '2026-02-03T04:05:06.789Z'
        && $decoded['nested']['at'] instanceof DateTimeInterface);

    check('php re-encode matches node byte-for-byte',
        json_encode(Superjson::encode($decoded)) === json_encode($fixture['superjson']));

    // The audit chain is only tamper-evident while both runtimes hash the same
    // bytes. These two compare against hashes produced by the production
    // buildAuditEnvelope in server/services/audit.ts.
    $noMeta = Audit::buildEnvelope($fixture['auditInput'], null, 1789000000000);
    check('audit hash matches node (no metadata)', $noMeta['eventHash'] === $fixture['auditNoMeta']['eventHash']);

    $withMetaInput = $fixture['auditInput'];
    $withMetaInput['metadata'] = ['path' => '/reports/a b', 'note' => 'café — naïve', 'count' => 3];
    $withMeta = Audit::buildEnvelope($withMetaInput, $fixture['auditNoMeta']['eventHash'], 1789000000001);
    check('audit hash matches node (slashes and unicode in metadata)',
        $withMeta['eventHash'] === $fixture['auditWithMeta']['eventHash']);
    check('audit envelope links to the previous event',
        $withMeta['previousHash'] === $fixture['auditNoMeta']['eventHash']);
    check('audit envelope fields match node', $withMeta['resourceId'] === $fixture['auditWithMeta']['resourceId']
        && $withMeta['sensitivity'] === $fixture['auditWithMeta']['sensitivity']
        && $withMeta['actorType'] === $fixture['auditWithMeta']['actorType']);
} else {
    echo "cross-runtime: skipped, no fixture at $fixturePath\n";
}

echo "\n", $failures === 0 ? "all $checks checks passed\n" : "$failures of $checks checks FAILED\n";
exit($failures === 0 ? 0 : 1);
