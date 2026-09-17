import assert from "node:assert/strict";
import { entityCapabilityAllowed, roleCapabilities } from "../server/authz";
import { capabilityDelta, effectiveCapabilities, effectivePaths, slugifyRoleName, validateCustomRole } from "../server/services/roleDefinitions";
import { visibleWorkspacePaths } from "../client/src/lib/roleNavigation";

// Run: npx tsx scripts/check-roles.ts
// The smallest thing that fails if admin-defined roles stop behaving as presets over the
// built-in ones — i.e. if one could ever widen access past its base role.

const ok = (name: string) => console.log(`  ok  ${name}`);

// A denial beats a grant and beats the base role.
assert.equal(entityCapabilityAllowed("finance", "finance.write"), true);
assert.equal(entityCapabilityAllowed("finance", "finance.write", [], ["finance.write"]), false);
assert.equal(entityCapabilityAllowed("finance", "compliance.read", ["compliance.read"], ["compliance.read"]), false);
ok("a denial always wins");

// Grants still work when nothing is denied.
assert.equal(entityCapabilityAllowed("finance", "compliance.read"), false);
assert.equal(entityCapabilityAllowed("finance", "compliance.read", ["compliance.read"]), true);
ok("a grant widens the base role");

// A preset can never reach past what the base role plus the managed grant list allows.
const nightLead = validateCustomRole({
  name: "Night Lead",
  baseRole: "support_worker",
  grantedCapabilities: ["compliance.read", "document.write"],
  deniedCapabilities: ["resident_finance.write"],
  visiblePaths: ["/keyworker-app", "/care"],
});
const effective = effectiveCapabilities(nightLead);
assert.equal(effective.includes("document.write"), true);
assert.equal(effective.includes("resident_finance.write"), false);
assert.equal(effective.includes("config.write"), false, "a preset must never gain config.write");
assert.equal(effective.includes("finance.issue"), false, "a preset must never gain an ungrantable capability");
ok("a preset stays inside the managed grant list");

// Everything a preset holds is either in the base role or in the grant list — never invented.
const base = roleCapabilities.support_worker;
for (const capability of effective) {
  assert.equal(
    base.has(capability) || nightLead.grantedCapabilities.includes(capability),
    true,
    `${capability} appeared from nowhere`,
  );
}
ok("no capability appears from outside the base role or its grants");

// Ungrantable capabilities are refused at write time, not silently dropped.
assert.throws(() => validateCustomRole({
  name: "Sneaky", baseRole: "read_only",
  grantedCapabilities: ["config.write"], deniedCapabilities: [], visiblePaths: null,
}), /cannot be granted/);
ok("granting an ungrantable capability is rejected");

// Granting and denying the same capability is a mistake, not a silent denial.
assert.throws(() => validateCustomRole({
  name: "Contradiction", baseRole: "finance",
  grantedCapabilities: ["pack.write"], deniedCapabilities: ["pack.write"], visiblePaths: null,
}), /denial always wins/);
ok("a contradictory grant and denial is rejected");

// Navigation may only narrow: a page the base role cannot reach is refused.
assert.throws(() => validateCustomRole({
  name: "Overreach", baseRole: "support_worker",
  grantedCapabilities: [], deniedCapabilities: [], visiblePaths: ["/finance"],
}), /outside the support_worker role's navigation/);
ok("navigation cannot be widened past the base role");

// An unset page list inherits the base role's navigation.
const inherited = validateCustomRole({
  name: "Plain Finance", baseRole: "finance",
  grantedCapabilities: [], deniedCapabilities: [], visiblePaths: null,
});
assert.deepEqual(effectivePaths(inherited), visibleWorkspacePaths("finance"));
assert.deepEqual(effectivePaths(nightLead), ["/care", "/keyworker-app"]);
ok("an unset page list inherits the base role");

// The delta shown in the UI reflects what actually changed.
const delta = capabilityDelta(nightLead);
assert.deepEqual(delta.added, ["document.write"], "compliance.read is already in support_worker, so it is not 'added'");
assert.deepEqual(delta.removed, ["resident_finance.write"]);
ok("the reported delta matches the real change");

assert.equal(slugifyRoleName("  Night Lead (North) "), "night-lead-north");
assert.throws(() => slugifyRoleName("!!!"), /at least one letter or number/);
ok("role names slugify predictably");

console.log("\nAll role-definition checks passed.");
