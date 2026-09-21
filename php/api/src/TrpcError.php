<?php
declare(strict_types=1);

namespace Hub;

/**
 * The tRPC error codes the client reacts to. main.tsx keys off
 * error.data.code === "UNAUTHORIZED" and "FORBIDDEN" to redirect or surface an
 * access message, so the codes and the JSON-RPC numbers below must stay exactly
 * as the Node server emitted them.
 */
final class TrpcError extends \RuntimeException
{
    private const CODES = [
        'PARSE_ERROR' => [-32700, 400],
        'BAD_REQUEST' => [-32600, 400],
        'INTERNAL_SERVER_ERROR' => [-32603, 500],
        'UNAUTHORIZED' => [-32001, 401],
        'FORBIDDEN' => [-32003, 403],
        'NOT_FOUND' => [-32004, 404],
        'METHOD_NOT_SUPPORTED' => [-32005, 405],
        'TIMEOUT' => [-32008, 408],
        'CONFLICT' => [-32009, 409],
        'PRECONDITION_FAILED' => [-32012, 412],
        'PAYLOAD_TOO_LARGE' => [-32013, 413],
        'UNPROCESSABLE_CONTENT' => [-32022, 422],
        'TOO_MANY_REQUESTS' => [-32029, 429],
    ];

    /** @param array<string, mixed>|null $workspaceError */
    public function __construct(
        public readonly string $trpcCode,
        string $message,
        public readonly ?array $workspaceError = null,
    ) {
        parent::__construct($message);
    }

    public function jsonRpcCode(): int
    {
        return (self::CODES[$this->trpcCode] ?? self::CODES['INTERNAL_SERVER_ERROR'])[0];
    }

    public function httpStatus(): int
    {
        return (self::CODES[$this->trpcCode] ?? self::CODES['INTERNAL_SERVER_ERROR'])[1];
    }

    public static function unauthorized(string $message): self
    {
        return new self('UNAUTHORIZED', $message);
    }

    public static function forbidden(string $message): self
    {
        return new self('FORBIDDEN', $message);
    }

    public static function badRequest(string $message): self
    {
        return new self('BAD_REQUEST', $message);
    }

    public static function notFound(string $message): self
    {
        return new self('NOT_FOUND', $message);
    }
}
