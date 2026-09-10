import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ entityId: 1 }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    staffWorkspace: {
      context: { useQuery: () => ({ isLoading: true, error: null }) },
      staffWorkspace: { useQuery: () => ({ isLoading: false, error: null }) },
    },
  },
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => null,
}));

import StaffWorkspacePage from "./StaffWorkspace";

describe("StaffWorkspacePage loading state", () => {
  it("renders an accessible skeleton while staff workspace data is pending", () => {
    const html = renderToStaticMarkup(<StaffWorkspacePage />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading staff workspace"');
  });
});
