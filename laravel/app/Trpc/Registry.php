<?php

declare(strict_types=1);

namespace App\Trpc;

use App\Support\LocalAuth;
use App\Support\Superjson;
use Illuminate\Http\Request;
use JsonException;
use Throwable;

/**
 * A tRPC-compatible dispatcher.
 *
 * The React client is unchanged: it still uses httpBatchLink with the superjson
 * transformer against /api/trpc, so this speaks that protocol exactly rather
 * than a REST shape of its own.
 *
 *   query     GET  /api/trpc/a.b,c.d?batch=1&input={"0":{...},"1":{...}}
 *   mutation  POST /api/trpc/a.b            body {"json": ...}
 *   response  batched: [{"result":{"data":{json,meta}}}, {"error":{...}}]
 *             single:  {"result":{"data":{json,meta}}}
 *
 * Guards correspond to the procedure builders in server/_core/trpc.ts:
 *   public      publicProcedure
 *   credential  credentialChangeProcedure: signed in, but allowed through with a
 *               pending password change, since that is what it exists to fix
 *   user        protectedProcedure, which also refuses a pending password change
 *   admin       adminProcedure
 */
final class Registry
{
    public const PUBLIC = 'public';
    public const CREDENTIAL = 'credential';
    public const USER = 'user';
    public const ADMIN = 'admin';

    /** @var array<string, array{type: string, guard: string, handler: callable}> */
    private array $procedures = [];

    public function query(string $path, string $guard, callable $handler): void
    {
        $this->procedures[$path] = ['type' => 'query', 'guard' => $guard, 'handler' => $handler];
    }

    public function mutation(string $path, string $guard, callable $handler): void
    {
        $this->procedures[$path] = ['type' => 'mutation', 'guard' => $guard, 'handler' => $handler];
    }

    public function has(string $path): bool
    {
        return isset($this->procedures[$path]);
    }

    /** @return array<int, string> */
    public function paths(): array
    {
        $paths = array_keys($this->procedures);
        sort($paths);

        return $paths;
    }

    /**
     * Runs the request and returns the status and the response body, already in
     * the shape the client expects.
     *
     * @return array{status: int, body: mixed}
     */
    public function handle(Context $ctx, Request $request, string $procedurePath): array
    {
        $isBatch = $request->query('batch') === '1';
        $paths = array_values(array_filter(explode(',', trim($procedurePath, '/'))));

        if ($paths === []) {
            return [
                'status' => 404,
                'body' => $this->errorBody(TrpcException::notFound('No procedure named in the request path'), ''),
            ];
        }

        try {
            $inputs = $this->readInputs($request, $isBatch, count($paths));
        } catch (TrpcException $error) {
            return ['status' => $error->httpStatus(), 'body' => $this->errorBody($error, $paths[0])];
        }

        $results = [];
        $firstErrorStatus = null;

        foreach ($paths as $index => $path) {
            try {
                $value = $this->invoke($ctx, $request->method(), $path, $inputs[$index] ?? null);
                $results[] = ['result' => ['data' => Superjson::encode($value)]];
            } catch (Throwable $error) {
                $trpcError = $this->asTrpcException($error, $path);
                $firstErrorStatus ??= $trpcError->httpStatus();
                $results[] = $this->errorBody($trpcError, $path);
            }
        }

        if (!$isBatch) {
            return ['status' => $firstErrorStatus ?? 200, 'body' => $results[0]];
        }

        // A batch always answers 200: the client reads each entry separately, and
        // a transport-level error status would discard the entries that worked.
        return ['status' => 200, 'body' => $results];
    }

    /** @return array<int, mixed> */
    private function readInputs(Request $request, bool $isBatch, int $count): array
    {
        $raw = $request->isMethod('GET')
            ? $request->query('input')
            : $request->getContent();

        if (!is_string($raw) || $raw === '') {
            return array_fill(0, max($count, 1), null);
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new TrpcException('PARSE_ERROR', 'Request input was not valid JSON');
        }

        if (!$isBatch) {
            return [Superjson::decode($decoded)];
        }

        $inputs = [];
        for ($index = 0; $index < $count; $index++) {
            // tRPC omits the key entirely for a procedure called without input,
            // so a missing index means null rather than a malformed request.
            $inputs[$index] = is_array($decoded) && array_key_exists((string) $index, $decoded)
                ? Superjson::decode($decoded[(string) $index])
                : null;
        }

        return $inputs;
    }

    private function invoke(Context $ctx, string $method, string $path, mixed $input): mixed
    {
        $procedure = $this->procedures[$path] ?? null;
        if ($procedure === null) {
            throw TrpcException::notFound("No procedure found on path \"$path\"");
        }

        if ($procedure['type'] === 'mutation' && $method !== 'POST') {
            throw new TrpcException('METHOD_NOT_SUPPORTED', "Mutation \"$path\" must be called with POST");
        }
        if ($procedure['type'] === 'query' && $method !== 'GET') {
            throw new TrpcException('METHOD_NOT_SUPPORTED', "Query \"$path\" must be called with GET");
        }

        $this->enforceGuard($ctx, $procedure['guard']);

        return ($procedure['handler'])($ctx, $input);
    }

    private function enforceGuard(Context $ctx, string $guard): void
    {
        if ($guard === self::PUBLIC) {
            return;
        }

        $user = $ctx->requireUser();

        if ($guard === self::ADMIN && ($user['role'] ?? 'user') !== 'admin') {
            throw TrpcException::forbidden('You do not have administrator access.');
        }

        // CREDENTIAL stops here on purpose: the procedures behind it are the ones
        // that clear a pending password change.
        if ($guard === self::USER && LocalAuth::requiresPasswordChange((int) $user['id'])) {
            throw TrpcException::forbidden('Update your temporary password before accessing operational records.');
        }
    }

    private function asTrpcException(Throwable $error, string $path): TrpcException
    {
        if ($error instanceof TrpcException) {
            return $error;
        }

        // Anything unplanned is reported in full to the log and as a bare 500 to
        // the caller: a database message can carry the connection string and a
        // stack trace can carry record contents, and neither belongs in a
        // browser.
        report($error);

        return new TrpcException('INTERNAL_SERVER_ERROR', 'Something went wrong on the server.');
    }

    /** @return array<string, mixed> */
    private function errorBody(TrpcException $error, string $path): array
    {
        $data = [
            'code' => $error->trpcCode,
            'httpStatus' => $error->httpStatus(),
            'path' => $path,
        ];

        // server/_core/trpc.ts adds workspaceError to the error shape and the
        // client reads it to place field-level messages, so it is carried on.
        if ($error->workspaceError !== null) {
            $data['workspaceError'] = $error->workspaceError;
        }

        return ['error' => Superjson::encode([
            'message' => $error->getMessage(),
            'code' => $error->jsonRpcCode(),
            'data' => $data,
        ])];
    }
}
