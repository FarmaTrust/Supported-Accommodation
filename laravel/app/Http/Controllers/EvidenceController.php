<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\EvidenceStorage;
use App\Support\WorkspaceGuards;
use App\Trpc\Context;
use App\Trpc\TrpcException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serves an uploaded file, after checking the caller may read it.
 *
 * The Node server handed out presigned S3 links, which are bearer tokens: once
 * issued, anyone holding the link can fetch the file until it expires, whatever
 * their role is by then. These are photographs of a young person's room and
 * scanned identity documents, so permission is checked on every request
 * instead, and each read is recorded.
 */
final class EvidenceController extends Controller
{
    public function __invoke(Request $request, string $key): Response
    {
        $ctx = Context::fromRequest($request);
        $user = $ctx->user;

        if ($user === null) {
            return response()->json(['error' => 'Sign in to continue.'], 401);
        }

        // The key comes from the URL, so it is looked up rather than trusted:
        // only a path an actual document version points at can be served.
        $version = DB::table('documentVersions as v')
            ->join('documents as d', 'd.id', '=', 'v.documentId')
            ->where('v.fileKey', $key)
            ->select(['v.fileName', 'v.mimeType', 'v.fileKey', 'd.id as documentId', 'd.entityId', 'd.classification'])
            ->first();

        if ($version === null || !EvidenceStorage::exists($key)) {
            return response()->json(['error' => 'Not found'], 404);
        }

        try {
            Authz::assertEntityCapability((int) $user['id'], (int) $version->entityId, 'document.read');

            if (in_array($version->classification, ['restricted', 'safeguarding', 'bank', 'hr', 'finance'], true)) {
                WorkspaceGuards::assertSensitiveAccess(
                    (int) $user['id'],
                    (int) $version->entityId,
                    (string) $version->classification,
                    'read',
                );
            }
        } catch (TrpcException $error) {
            return response()->json(['error' => $error->getMessage()], $error->httpStatus());
        }

        Audit::write([
            'actorUserId' => (int) $user['id'],
            'entityId' => (int) $version->entityId,
            'action' => 'document.download',
            'resourceType' => 'document',
            'resourceId' => (int) $version->documentId,
            'sensitivity' => (string) $version->classification,
            'result' => 'success',
            'reasonCode' => 'evidence_read',
        ]);

        $contents = EvidenceStorage::read($key);
        if ($contents === null) {
            return response()->json(['error' => 'Not found'], 404);
        }

        return new StreamedResponse(static function () use ($contents): void {
            echo $contents;
        }, 200, [
            'Content-Type' => $version->mimeType,
            // attachment, and nosniff, so a file someone uploaded cannot be
            // rendered as script in the browser against another user.
            'Content-Disposition' => 'attachment; filename="' . addslashes((string) $version->fileName) . '"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
            'Content-Length' => (string) strlen($contents),
        ]);
    }
}
