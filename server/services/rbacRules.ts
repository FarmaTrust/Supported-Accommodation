import type { Capability, OperationalRole } from "../authz";

export const MANAGEABLE_ROLES = ["owner", "registered_manager", "support_worker", "hr_compliance", "finance", "read_only"] as const satisfies readonly OperationalRole[];
export const MANAGEABLE_CAPABILITIES = ["pack.read", "pack.write", "compliance.read", "compliance.write", "document.read", "document.write", "supervision.read", "staff.self_service"] as const satisfies readonly Capability[];
export type ManageableCapability = typeof MANAGEABLE_CAPABILITIES[number];

export const ROLE_LABELS: Record<(typeof MANAGEABLE_ROLES)[number], string> = {
  owner: "Company administrator",
  registered_manager: "Registered manager",
  support_worker: "Key Worker / support worker",
  hr_compliance: "HR & compliance",
  finance: "Finance",
  read_only: "Read only",
};

export const CAPABILITY_LABELS: Record<ManageableCapability, string> = {
  "pack.read": "View provider and authority packs",
  "pack.write": "Create and update provider and authority packs",
  "compliance.read": "View compliance registers and alerts",
  "compliance.write": "Manage compliance records and renewals",
  "document.read": "View authorised documents",
  "document.write": "Upload and manage authorised documents",
  "supervision.read": "View supervision records",
  "staff.self_service": "Use personal staff self-service workflows",
};

export function propertyAssignmentTypeForRole(role: (typeof MANAGEABLE_ROLES)[number]) {
  if (role === "registered_manager") return "manager" as const;
  if (role === "support_worker") return "worker" as const;
  if (role === "hr_compliance") return "compliance" as const;
  if (role === "finance") return "finance" as const;
  return "viewer" as const;
}

export function normaliseManagedCapabilities(capabilities: readonly string[]) {
  return Array.from(new Set(capabilities)).sort();
}

export function requireMeaningfulAccessReason(reason: string) {
  if (reason.trim().length < 20) throw new Error("Enter a clear access-change reason of at least 20 characters so the audit trail explains the decision.");
  return reason.trim();
}

export function canRemoveOwner(input: { currentRole: OperationalRole; nextRole: OperationalRole; activeOwnerCount: number }) {
  return !(input.currentRole === "owner" && input.nextRole !== "owner" && input.activeOwnerCount <= 1);
}
