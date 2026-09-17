import { allCapabilities, roleCapabilities, type Capability, type OperationalRole } from "../authz";
import { MANAGEABLE_CAPABILITIES, MANAGEABLE_ROLES } from "./rbacRules";
import { visibleWorkspacePaths } from "../../client/src/lib/roleNavigation";

/**
 * Admin-defined roles are presets over the built-in ones, never replacements. A preset names a
 * base role, then widens it with managed capabilities and narrows it with denials. Every check in
 * server/authz.ts still runs against the base role, so nothing here can reach past what that role
 * already allows — grants are bounded by the managed list, denials only ever remove access, and
 * navigation can only be narrowed.
 */

export type CustomRoleDefinition = {
  baseRole: OperationalRole;
  grantedCapabilities: string[];
  deniedCapabilities: string[];
  visiblePaths: string[] | null;
};

export function slugifyRoleName(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  if (!slug) throw new Error("Enter a role name that contains at least one letter or number.");
  return slug;
}

export function cleanCapabilityList(value: unknown, allowed: readonly string[]) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && allowed.includes(item)))).sort();
}

export function cleanPathList(value: unknown) {
  if (!Array.isArray(value)) return null;
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string"))).sort();
}

/**
 * Validate a definition before it is stored. Throws with an operator-readable message, so the
 * router and the CLI both surface the same wording.
 */
export function validateCustomRole(input: {
  name: string;
  baseRole: string;
  grantedCapabilities: string[];
  deniedCapabilities: string[];
  visiblePaths: string[] | null;
  /** Set when editing one of the seven built-in rows, which may not change identity. */
  builtInSlug?: string | null;
}): CustomRoleDefinition & { name: string; slug: string } {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Role name must be between 2 and 120 characters.");
  if (!MANAGEABLE_ROLES.includes(input.baseRole as never)) {
    throw new Error(`Base role must be one of: ${MANAGEABLE_ROLES.join(", ")}`);
  }
  const baseRole = input.baseRole as OperationalRole;
  if (input.builtInSlug && input.builtInSlug !== baseRole) {
    throw new Error("A built-in role cannot be re-based onto another role. Create a new role instead.");
  }
  // Without config.write on the company administrator, nobody could reach this screen again.
  if (input.builtInSlug === "owner" && input.deniedCapabilities.includes("config.write")) {
    throw new Error("The company administrator must keep config.write, or no one could manage roles and access again.");
  }

  for (const capability of input.grantedCapabilities) {
    if (!MANAGEABLE_CAPABILITIES.includes(capability as never)) {
      throw new Error(`"${capability}" cannot be granted. Grantable capabilities: ${MANAGEABLE_CAPABILITIES.join(", ")}`);
    }
  }
  for (const capability of input.deniedCapabilities) {
    if (!allCapabilities.includes(capability as Capability)) throw new Error(`"${capability}" is not a known capability.`);
  }
  const overlap = input.grantedCapabilities.filter(capability => input.deniedCapabilities.includes(capability));
  if (overlap.length) throw new Error(`Remove ${overlap.join(", ")} from either the granted or the denied list — a denial always wins.`);

  // Navigation may only be narrowed. A path the base role cannot reach would render a menu entry
  // that immediately fails its permission check.
  const basePaths = visibleWorkspacePaths(baseRole);
  const visiblePaths = input.visiblePaths === null ? null : cleanPathList(input.visiblePaths) ?? [];
  if (visiblePaths) {
    const unreachable = visiblePaths.filter(path => !basePaths.includes(path));
    if (unreachable.length) throw new Error(`${unreachable.join(", ")} is outside the ${baseRole} role's navigation. Pick a narrower page list.`);
    if (!visiblePaths.length) throw new Error("Select at least one page, or leave the page list unset to inherit the base role's navigation.");
  }

  return {
    name,
    slug: input.builtInSlug ?? slugifyRoleName(name),
    baseRole,
    grantedCapabilities: cleanCapabilityList(input.grantedCapabilities, MANAGEABLE_CAPABILITIES),
    deniedCapabilities: cleanCapabilityList(input.deniedCapabilities, allCapabilities),
    visiblePaths,
  };
}

/** The capabilities a holder of this preset actually has. */
export function effectiveCapabilities(definition: CustomRoleDefinition): Capability[] {
  const base = new Set<Capability>(Array.from(roleCapabilities[definition.baseRole] ?? []));
  for (const capability of definition.grantedCapabilities) base.add(capability as Capability);
  for (const capability of definition.deniedCapabilities) base.delete(capability as Capability);
  return Array.from(base).sort();
}

/** The workspace paths a holder of this preset sees. */
export function effectivePaths(definition: CustomRoleDefinition) {
  return definition.visiblePaths ?? visibleWorkspacePaths(definition.baseRole);
}

/** What the preset changed relative to its base role, for the review UI. */
export function capabilityDelta(definition: CustomRoleDefinition) {
  const base = roleCapabilities[definition.baseRole] ?? new Set<Capability>();
  return {
    added: definition.grantedCapabilities.filter(capability => !base.has(capability as Capability)).sort(),
    removed: definition.deniedCapabilities.filter(capability => base.has(capability as Capability)).sort(),
  };
}
