import { describe, expect, it } from "vitest";
import { summariseReportCompletion } from "./reportCompletion";

describe("report completion rollups", () => {
  it("groups factual report state by property and Key Worker without inventing an expected schedule", () => {
    const groups = summariseReportCompletion([
      { id: 1, propertyId: 2, propertyName: "Birch House", authorUserId: 7, authorName: "Jamie Patel", status: "submitted", reportDate: 100 },
      { id: 2, propertyId: 2, propertyName: "Birch House", authorUserId: 7, authorName: "Jamie Patel", status: "returned", reportDate: 110 },
      { id: 3, propertyId: 2, propertyName: "Birch House", authorUserId: 8, authorName: "Alex Green", status: "approved", reportDate: 120 },
      { id: 4, propertyId: 4, propertyName: "Cedar House", authorUserId: 8, authorName: "Alex Green", status: "draft", reportDate: 130 },
    ]);
    expect(groups.map(group => group.propertyName)).toEqual(["Birch House", "Cedar House"]);
    expect(groups[0]).toEqual(expect.objectContaining({ propertyId: 2, latestReportAt: 120, counts: expect.objectContaining({ logged: 2, needsCompletion: 1, awaitingReview: 1, approvedOrLocked: 1 }) }));
    expect(groups[0]?.keyWorkers[0]).toEqual(expect.objectContaining({ name: "Alex Green", counts: expect.objectContaining({ approved: 1, logged: 1 }) }));
    expect(groups[1]?.counts).toEqual(expect.objectContaining({ draft: 1, needsCompletion: 1, logged: 0 }));
  });
});
