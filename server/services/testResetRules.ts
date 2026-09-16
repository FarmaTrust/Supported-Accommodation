export const TEST_ENTITY_NAME = "TEST — Training Provider";
export const TEST_EMAIL_SUFFIX = ".example.test";

export function isVisibleTestResetEligible(input: { email: string; hasActiveTestMembership: boolean; hasActiveOperationalMembership: boolean }) {
  return input.email.endsWith(TEST_EMAIL_SUFFIX) && input.hasActiveTestMembership && !input.hasActiveOperationalMembership;
}
