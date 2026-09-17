export type WorkspaceNavigationRole =
  | "platform_admin"
  | "owner"
  | "registered_manager"
  | "support_worker"
  | "hr_compliance"
  | "finance"
  | "read_only";

const ALL_BUSINESS_PATHS = [
  "/", "/properties", "/workforce", "/access-control", "/manager-app", "/staff", "/placements", "/rota", "/rota-controls",
  "/compliance-dashboard", "/compliance", "/governance", "/work-plans", "/finance", "/documents", "/assurance", "/quality-reviews",
  "/regulation-28", "/care", "/safeguarding", "/keyworker-app", "/nominated-individual", "/role-management",
] as const;

const pathsByRole: Record<WorkspaceNavigationRole, readonly string[]> = {
  // The platform administrator account used in this TEST environment has an explicit owner membership.
  // Keep the established operational workspace view while adding its dedicated Superadmin entry elsewhere.
  platform_admin: ALL_BUSINESS_PATHS,
  owner: ALL_BUSINESS_PATHS,
  registered_manager: ALL_BUSINESS_PATHS.filter(path => path !== "/access-control" && path !== "/rota-controls" && path !== "/nominated-individual" && path !== "/role-management"),
  support_worker: ["/keyworker-app", "/properties", "/care", "/staff"],
  hr_compliance: ["/", "/properties", "/workforce", "/staff", "/rota", "/compliance-dashboard", "/compliance", "/governance", "/documents", "/assurance", "/quality-reviews", "/regulation-28"],
  finance: ["/", "/properties", "/compliance-dashboard", "/compliance", "/finance", "/documents"],
  read_only: ["/", "/properties", "/workforce", "/rota", "/compliance-dashboard", "/compliance", "/documents"],
};

export function canViewWorkspaceNavigation(role: string | null | undefined, path: string) {
  return Boolean(role && Object.prototype.hasOwnProperty.call(pathsByRole, role) && pathsByRole[role as WorkspaceNavigationRole].includes(path));
}

export function visibleWorkspacePaths(role: string | null | undefined) {
  if (!role || !Object.prototype.hasOwnProperty.call(pathsByRole, role)) return [];
  return [...pathsByRole[role as WorkspaceNavigationRole]];
}
