import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("fictional room occupancy fixtures", () => {
  it("links each fictional active placement to a named occupied room through an idempotent move-in event", () => {
    const loader = read("scripts/load-fictional-test-data.mjs");
    expect(loader).toContain("async function ensureRoomOccupancy");
    expect(loader).toContain("occupancyEvents");
    expect(loader).toContain("'move_in'");
    expect(loader).toContain("for(const propertyId of propertyIds)await ensureRoomOccupancy(propertyId,actorId)");
  });

  it("clears dependent TEST-only shift rows before reseeding and verifies all scenario occupancy assignments", () => {
    const loader = read("scripts/load-fictional-test-data.mjs");
    const verifier = read("scripts/verify-fictional-test-data.mjs");
    expect(loader).toContain("async function clearScenarioShifts");
    expect(loader).toContain("shiftChangeAcknowledgements");
    expect(verifier).toContain("occupiedRoomAssignments");
    expect(verifier).toContain("actual.occupiedRoomAssignments === scenario.youngPeople.length");
  });
});
