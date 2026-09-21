<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\Crypto;
use App\Support\EncryptedFields;
use PHPUnit\Framework\TestCase;

/**
 * This is the layer that stands between the encrypted columns and the browser.
 * The behaviour that matters is not that it decrypts, but that a field nobody
 * remembered to name is withheld rather than shipped raw.
 */
final class EncryptedFieldsTest extends TestCase
{
    protected function setUp(): void
    {
        putenv('JWT_SECRET=test-secret-value-1234567890');
        $_ENV['JWT_SECRET'] = 'test-secret-value-1234567890';
        $_SERVER['JWT_SECRET'] = 'test-secret-value-1234567890';
    }

    public function test_a_named_field_is_revealed_under_its_plain_name(): void
    {
        $row = ['id' => 1, 'summaryCiphertext' => Crypto::encrypt('A disclosure was made')];

        $revealed = EncryptedFields::reveal($row, ['summary']);

        $this->assertSame('A disclosure was made', $revealed['summary']);
        $this->assertSame(1, $revealed['id']);
    }

    public function test_the_ciphertext_column_never_survives(): void
    {
        $row = ['id' => 1, 'summaryCiphertext' => Crypto::encrypt('A disclosure was made')];

        $this->assertArrayNotHasKey('summaryCiphertext', EncryptedFields::reveal($row, ['summary']));
    }

    public function test_a_field_nobody_named_is_withheld_rather_than_returned_raw(): void
    {
        // The case this class exists for: a procedure reveals one field and
        // forgets another. The forgotten one must not reach the client, in
        // either form.
        $row = [
            'id' => 1,
            'summaryCiphertext' => Crypto::encrypt('shown'),
            'vehicleRegistrationCiphertext' => Crypto::encrypt('AB12 CDE'),
        ];

        $revealed = EncryptedFields::reveal($row, ['summary']);

        $this->assertSame('shown', $revealed['summary']);
        $this->assertArrayNotHasKey('vehicleRegistrationCiphertext', $revealed);
        $this->assertArrayNotHasKey('vehicleRegistration', $revealed);
    }

    public function test_a_missing_or_empty_column_reads_as_null(): void
    {
        $revealed = EncryptedFields::reveal(['id' => 1, 'notesCiphertext' => null], ['notes', 'absent']);

        $this->assertNull($revealed['notes']);
        $this->assertNull($revealed['absent']);
    }

    public function test_an_unreadable_column_reads_as_null_rather_than_failing_the_request(): void
    {
        // One corrupted note must not take a shift handover offline.
        $revealed = EncryptedFields::reveal(['id' => 1, 'notesCiphertext' => 'not.valid.ciphertext'], ['notes']);

        $this->assertNull($revealed['notes']);
        $this->assertSame(1, $revealed['id']);
    }

    public function test_strip_removes_every_ciphertext_column(): void
    {
        $stripped = EncryptedFields::strip([
            'id' => 1,
            'aCiphertext' => 'x',
            'bCiphertext' => 'y',
            'plain' => 'kept',
        ]);

        $this->assertSame(['id' => 1, 'plain' => 'kept'], $stripped);
    }

    public function test_seal_leaves_an_empty_value_empty(): void
    {
        $this->assertNull(EncryptedFields::seal(null));
        $this->assertNull(EncryptedFields::seal(''));

        $sealed = EncryptedFields::seal('12-34-56');
        $this->assertIsString($sealed);
        $this->assertSame('12-34-56', Crypto::decrypt($sealed));
    }

    public function test_reveal_all_handles_database_row_objects(): void
    {
        $rows = [(object) ['id' => 1, 'nameCiphertext' => Crypto::encrypt('Ada')]];

        $revealed = EncryptedFields::revealAll($rows, ['name']);

        $this->assertSame('Ada', $revealed[0]['name']);
        $this->assertArrayNotHasKey('nameCiphertext', $revealed[0]);
    }
}
