import { createTRPCReact } from "@trpc/react-query";

/**
 * The tRPC client for a server this project no longer describes in TypeScript.
 *
 * The API is a Laravel application (`laravel/app/Trpc`) speaking the tRPC wire
 * protocol. Nothing about the transport changed, but there is no AppRouter to
 * infer from any more, so the hooks are declared structurally here: every
 * `trpc.<router>.<procedure>` resolves and runs, and its input and output are
 * `any`.
 *
 * That is a real loss of compile-time safety, and it is deliberate. The
 * alternative was keeping several thousand lines of retired Node server beside
 * the PHP purely as a type source — nothing would run it, nothing would test
 * it, and the two would drift apart silently, which is worse than an honest
 * `any`. Where a shape is worth stating, the screen states it: see the
 * Workspace type in pages/RoleManagement.tsx.
 */

type Hooks = {
  useQuery: (...args: any[]) => any;
  useSuspenseQuery: (...args: any[]) => any;
  useInfiniteQuery: (...args: any[]) => any;
  useMutation: (...args: any[]) => any;
};

type Utils = {
  invalidate: (...args: any[]) => Promise<void>;
  setData: (...args: any[]) => void;
  getData: (...args: any[]) => any;
  fetch: (...args: any[]) => Promise<any>;
  cancel: (...args: any[]) => Promise<void>;
  refetch: (...args: any[]) => Promise<any>;
};

type Namespace<T> = { [procedure: string]: T };

type TrpcReact = {
  Provider: (props: any) => any;
  createClient: (...args: any[]) => any;
  useUtils: () => { client: any } & { [router: string]: Namespace<Utils> };
  useContext: () => { client: any } & { [router: string]: Namespace<Utils> };
} & { [router: string]: Namespace<Hooks> };

export const trpc = createTRPCReact() as unknown as TrpcReact;
