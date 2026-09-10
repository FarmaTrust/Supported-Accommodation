export type SearchWorkspaceTab = "search" | "notifications" | "automation";

export function notificationTabFromSearch(search: string): SearchWorkspaceTab {
  const requested = new URLSearchParams(search).get("tab");
  return requested === "notifications" || requested === "automation" ? requested : "search";
}
