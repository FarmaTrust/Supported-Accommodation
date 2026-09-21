<?php
declare(strict_types=1);

namespace Hub;

/**
 * A tRPC-compatible dispatcher.
 *
 * The React client is unchanged: it still uses httpBatchLink with the superjson
 * transformer against /api/trpc, so this class has to speak that protocol
 * exactly rather than a REST shape of its own.
 *
 *   query     GET  /api/trpc/a.b,c.d?batch=1&input={"0":{...},"1":{...}}
 *   mutation  POST /api/trpc/a.b            body {"json": ...}
 *   response  batched: [{"result":{"data":{json,meta}}}, {"error":{...}}]
 *             single:  {"result":{"data":{json,meta}}}
 *
 * Guards correspond to the procedure builders in server/_core/trpc.ts:
 *   public    publicProcedure
 *   user      protectedProcedure, which also refuses a pending password change
 *   admin     adminProcedure
 */
final class Trpc
{
    public const PUBLIC = 'public';
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

    /** @return array<int, string> */
    public function registered(): array
    {
        return array_keys($this->procedures);
    }

    /**
     * Runs the request and returns the status and the decoded response body.
     *
     * @param array<string, string> $query
     * @return array{status: int, body: mixed}
     */
    public function handle(Context $ctx, string $method, string $procedurePath, array $query, string $rawBody): array
    {
        $isBatch = ($query['batch'] ?? '0') === '1';
        $paths = array_values(array_filter(explode(',', trim($procedurePath, '/'))));

        if ($paths === []) {
            return ['status' => 404, 'body' => $this->errorBody(TrpcError::notFound('No procedure named in the request path'), '')];
        }

        $inputs = $this->readInputs($method, $query, $rawBody, $isBatch, count($paths));

        $results = [];
        $firstErrorStatus = null;
        foreach ($paths as $index => $path) {
            try {
                $results[] = ['result' => ['data' => Superjson::encode($this->invoke($ctx, $method, $path, $inputs[$index] ?? null))]];
            } catch (\Throwable $error) {
                $trpcError = $this->asTrpcError($error);
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

    /**
     * @param array<string, string> $query
     * @return array<int, mixed>
     */
    private function readInputs(string $method, array $query, string $rawBody, bool $isBatch, int $count): array
    {
        $raw = $method === 'GET' ? ($query['input'] ?? null) : ($rawBody === '' ? null : $rawBody);
        if ($raw === null || $raw === '') {
            return array_fill(0, max($count, 1), null);
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new TrpcError('PARSE_ERROR', 'Request input was not valid JSON');
        }

        if (!$isBatch) {
            return [Superjson::decode($decoded)];
        }

        $inputs = [];
        for ($index = 0; $index < $count; $index++) {
            // tRPC omits the key entirely for a procedure called without input,
            // so a missing index means null rather than a malformed request.
            $inputs[$index] = array_key_exists((string) $index, $decoded)
                ? Superjson::decode($decoded[(string) $index])
                : null;
        }

        return $inputs;
    }

    private function invoke(Context $ctx, string $method, string $path, mixed $input): mixed
    {
        $procedure = $this->procedures[$path] ?? null;
        if ($procedure === null) {
            throw TrpcError::notFound("No procedure found on path \"$path\"");
        }

        if ($procedure['type'] === 'mutation' && $method !== 'POST') {
            throw new TrpcError('METHOD_NOT_SUPPORTED', "Mutation \"$path\" must be called with POST");
        }
        if ($procedure['type'] === 'query' && $method !== 'GET') {
            throw new TrpcError('METHOD_NOT_SUPPORTED', "Query \"$path\" must be called with GET");
        }

        $this->enforceGuard($ctx, $procedure['guard']);

        return ($procedure['handler'])($ctx, $input);
    }

    private function enforceGuard(Context $ctx, string $guard): void
    {
        if ($guard === self::PUBLIC) {
            return;
        }

        $user = $ctx->user;
        if ($user === null) {
            throw TrpcError::unauthorized('Sign in to continue.');
        }

        if ($guard === self::ADMIN && ($user['role'] ?? 'user') !== 'admin') {
            throw TrpcError::forbidden('You do not have administrator access.');
        }

        if ($guard === self::USER && LocalAuth::requiresPasswordChange((int) $user['id'])) {
            throw TrpcError::forbidden('Update your temporary password before accessing operational records.');
        }
    }

    private function asTrpcError(\Throwable $error): TrpcError
    {
        if ($error instanceof TrpcError) {
            return $error;
        }

        // Anything unplanned is logged in full and reported as a bare 500: a PDO
        // message can carry the connection string and a stack trace can carry
        // record contents, and neither belongs in a browser.
        error_log('[trpc] ' . $error::class . ': ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());

        return new TrpcError('INTERNAL_SERVER_ERROR', 'Something went wrong on the server.');
    }

    /** @return array<string, mixed> */
    private function errorBody(TrpcError $error, string $path): array
    {
        $data = [
            'code' => $error->trpcCode,
            'httpStatus' => $error->httpStatus(),
            'path' => $path,
        ];

        // server/_core/trpc.ts adds workspaceError to the error shape; the client
        // reads it to place field-level messages, so it is carried through.
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
