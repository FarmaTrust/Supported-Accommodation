<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Where uploaded evidence is kept.
 *
 * The Node server put files in S3 through the Manus Forge API and handed back a
 * presigned URL. That service is not reachable from this deployment, so files
 * are stored on the application's own private disk instead and served through a
 * route that re-checks permission on every download.
 *
 * That is a deliberate difference rather than a shortcut. A presigned URL is a
 * bearer token: anyone holding the link can fetch the file until it expires,
 * whatever their role is by then. For photographs of a young person's room and
 * scanned identity documents, checking each time is the behaviour worth having.
 *
 * Files live under storage/app/private, which is outside the document root, so
 * no URL reaches them directly.
 */
final class EvidenceStorage
{
    public const DISK = 'local';
    public const MAX_BYTES = 8 * 1024 * 1024;

    /** @var array<int, string> */
    public const ALLOWED_MIME_TYPES = [
        'image/jpeg', 'image/png', 'image/webp', 'image/heic',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    /**
     * @return array{key: string, url: string, sizeBytes: int, contentHash: string, fileName: string}
     */
    public static function putBase64(int $entityId, int $userId, string $fileName, string $mimeType, string $contentBase64): array
    {
        if (!in_array($mimeType, self::ALLOWED_MIME_TYPES, true)) {
            throw WorkspacePolicy::fieldError('mime_type_unsupported', 'mimeType', 'That file type cannot be uploaded here.');
        }

        // strict: a payload that is not valid base64 is refused rather than
        // silently decoded into rubbish and stored.
        $bytes = base64_decode($contentBase64, true);
        if ($bytes === false || $bytes === '') {
            throw WorkspacePolicy::fieldError('file_unreadable', 'contentBase64', 'The uploaded file could not be read.');
        }

        if (strlen($bytes) > self::MAX_BYTES) {
            throw new TrpcException('PAYLOAD_TOO_LARGE', 'Files must be 8 MB or smaller');
        }

        // The uploader names the file, so the name is reduced to characters that
        // cannot walk out of the directory or confuse the filesystem.
        $safeName = (string) preg_replace('/[^a-zA-Z0-9._-]/', '_', $fileName);
        $safeName = trim($safeName, '.') ?: 'upload';

        $key = sprintf(
            'evidence/%d/%d/%d-%s-%s',
            $entityId,
            $userId,
            Dates::nowMillis(),
            Str::lower(Str::random(8)),
            $safeName,
        );

        Storage::disk(self::DISK)->put($key, $bytes);

        return [
            'key' => $key,
            // Not a direct file URL: this path is handled by a route that checks
            // the caller may read the document before streaming it.
            'url' => '/api/evidence/' . rawurlencode($key),
            'sizeBytes' => strlen($bytes),
            // Lets a later verification show the stored bytes are the ones that
            // were uploaded.
            'contentHash' => hash('sha256', $bytes),
            'fileName' => $safeName,
        ];
    }

    /**
     * Stores bytes this application generated, rather than bytes somebody
     * uploaded: an invoice or statement PDF. No size or type check applies,
     * because the content came from here.
     *
     * @return array{key: string, url: string, sizeBytes: int, contentHash: string, fileName: string}
     */
    public static function putBytes(string $directory, string $fileName, string $mimeType, string $bytes): array
    {
        $safeName = (string) preg_replace('/[^a-zA-Z0-9._-]/', '_', $fileName);
        $safeName = trim($safeName, '.') ?: 'document';

        $key = sprintf(
            '%s/%d-%s-%s',
            trim($directory, '/'),
            Dates::nowMillis(),
            Str::lower(Str::random(8)),
            $safeName,
        );

        Storage::disk(self::DISK)->put($key, $bytes);

        return [
            'key' => $key,
            'url' => '/api/evidence/' . rawurlencode($key),
            'sizeBytes' => strlen($bytes),
            'contentHash' => hash('sha256', $bytes),
            'fileName' => $safeName,
        ];
    }

    public static function exists(string $key): bool
    {
        return Storage::disk(self::DISK)->exists($key);
    }

    public static function read(string $key): ?string
    {
        return self::exists($key) ? Storage::disk(self::DISK)->get($key) : null;
    }
}
