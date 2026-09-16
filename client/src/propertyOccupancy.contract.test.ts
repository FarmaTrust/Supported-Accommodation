import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const source = readFileSync(new URL("client/src/pages/Properties.tsx", root), "utf8");

describe("property occupancy and evidence presentation", () => {
  it("keeps the property detail response separate from resident disclosure and opens an explicit occupied-room control", () => {
    expect(source).toContain('unit.status === "occupied"');
    expect(source).toContain("setOccupancyUnit({ id: unit.id, label: unit.label })");
    expect(source).toContain("View resident assigned to");
    expect(source).toContain("trpc.entities.unitOccupancy.useQuery");
    expect(source).toContain("server confirms your property and placement access");
  });

  it("uses accessible icon indicators rather than written RAG colour labels for property evidence", () => {
    expect(source).toContain("function EvidenceStatusIndicator");
    expect(source).toContain("CheckCircle2");
    expect(source).toContain("TriangleAlert");
    expect(source).toContain("CircleX");
    expect(source).toContain('aria-label={presentation.label}');
    expect(source).toContain("Evidence current");
    expect(source).toContain("Evidence overdue");
    expect(source).not.toContain("StatusBadge status={item.ragStatus}");
  });
});
