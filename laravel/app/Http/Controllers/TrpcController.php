<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Trpc\Context;
use App\Trpc\RouterRegistrar;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The single entry point for every tRPC call.
 *
 * One route rather than one per procedure: the client batches several
 * procedures into a single request, so the path can name more than one and
 * Laravel's router cannot match them individually.
 */
final class TrpcController extends Controller
{
    public function __invoke(Request $request, string $path): JsonResponse
    {
        $registry = RouterRegistrar::build();
        $context = Context::fromRequest($request);

        $result = $registry->handle($context, $request, $path);

        $response = new JsonResponse(
            $result['body'],
            $result['status'],
            ['Cache-Control' => 'no-store'],
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );

        // Sign-in, sign-out and a password change all reissue the session cookie
        // from inside a procedure; this is where those reach the response.
        foreach ($context->queuedCookies() as $cookie) {
            $response->headers->setCookie($cookie);
        }

        return $response;
    }
}
