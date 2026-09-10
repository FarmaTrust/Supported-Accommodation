import { TRPCError } from "@trpc/server";
import { assertEntityCapability, assertPlacementCapability, type OperationalRole } from "../authz";

export type WorkspaceSensitivity = "general" | "hr" | "finance" | "medication" | "safeguarding" | "bank" | "restricted";
export type WorkspaceFieldErrors = Record<string, string[]>;

export function workspaceFieldError(code: string, field: string, message: string, trpcCode: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" = "BAD_REQUEST") {
  const workspaceError = { code, fieldErrors: { [field]: [message] } satisfies WorkspaceFieldErrors };
  const error = new TRPCError({
    code: trpcCode,
    message,
    cause: workspaceError,
  });
  (error as TRPCError & { workspaceError: typeof workspaceError }).workspaceError = workspaceError;
  return error;
}

export function assertRecordState(status: string, allowed: readonly string[], field = "status") {
  if (!allowed.includes(status)) throw workspaceFieldError("record_state_invalid", field, `This action is not available while the record is ${status}.`, "CONFLICT");
}

export function assertManagerRole(role: OperationalRole) {
  if (role !== "owner" && role !== "registered_manager") throw workspaceFieldError("manager_required", "role", "Manager access is required for this action.", "FORBIDDEN");
}

export function requireAttendanceOverride(input: { locationState: "on_site" | "off_site" | "unavailable" | "manual"; overrideReason?: string | null }) {
  if (input.locationState !== "on_site" && !input.overrideReason?.trim()) throw workspaceFieldError("override_reason_required", "overrideReason", "An off-site, manual or unavailable location requires a reason.");
}

export async function assertSensitiveAccess(input: { userId: number; entityId: number; placementId?: number; sensitivity: WorkspaceSensitivity; mode?: "read" | "write" }) {
  const mode = input.mode ?? "read";
  if (input.placementId && ["safeguarding", "restricted", "medication", "finance"].includes(input.sensitivity)) {
    const capability = input.sensitivity === "medication" ? (mode === "write" ? "medication.write" : "young_person.read")
      : input.sensitivity === "finance" ? (mode === "write" ? "resident_finance.write" : "young_person.read")
        : mode === "write" ? "incident.write" : "incident.read";
    const access = await assertPlacementCapability(input.userId, input.placementId, capability);
    if (input.sensitivity === "restricted") assertManagerRole(access.access.role);
    return access.access;
  }
  const capability = input.sensitivity === "hr" ? (mode === "write" ? "staff.write" : "staff.sensitive")
    : input.sensitivity === "finance" || input.sensitivity === "bank" ? (mode === "write" ? "finance.write" : "finance.read")
      : input.sensitivity === "safeguarding" || input.sensitivity === "restricted" ? (mode === "write" ? "incident.review" : "incident.read")
        : "entity.read";
  const access = await assertEntityCapability(input.userId, input.entityId, capability);
  if (input.sensitivity === "bank" || input.sensitivity === "restricted") assertManagerRole(access.role);
  return access;
}

export async function assertHrAccess(input: { userId: number; entityId: number; subjectUserId: number; mode?: "read" | "write" }) {
  if (input.userId === input.subjectUserId) return assertEntityCapability(input.userId, input.entityId, "staff.self_service");
  return assertSensitiveAccess({ userId: input.userId, entityId: input.entityId, sensitivity: "hr", mode: input.mode ?? "read" });
}
