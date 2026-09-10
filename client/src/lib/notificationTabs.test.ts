import { describe, expect, it } from "vitest";
import { notificationTabFromSearch } from "./notificationTabs";

describe("notificationTabFromSearch", () => {
  it("selects the notifications panel from a direct notification link", () => {
    expect(notificationTabFromSearch("?entity=30001&tab=notifications")).toBe("notifications");
  });

  it("allows the known workspace tabs and defaults safely for missing or invalid values", () => {
    expect(notificationTabFromSearch("?tab=automation")).toBe("automation");
    expect(notificationTabFromSearch("?tab=other")).toBe("search");
    expect(notificationTabFromSearch("")).toBe("search");
  });
});
