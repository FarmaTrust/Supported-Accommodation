import { describe, expect, it } from "vitest";
import { newUnreadNotificationIds, unreadNotificationIds } from "./notificationSound";

describe("notification sound rules", () => {
  it("uses unread alerts as a baseline without pinging historical notifications", () => {
    const current = [{ id: 9, readAt: null }, { id: 2, readAt: null }, { id: 5, readAt: 100 }];
    expect(unreadNotificationIds(current)).toEqual([2, 9]);
    expect(newUnreadNotificationIds(null, current)).toEqual({ current: [2, 9], added: [] });
  });

  it("pings only new unread notification IDs after the baseline", () => {
    expect(newUnreadNotificationIds([2, 9], [{ id: 2, readAt: null }, { id: 9, readAt: null }, { id: 11, readAt: null }])).toEqual({ current: [2, 9, 11], added: [11] });
    expect(newUnreadNotificationIds([2, 9, 11], [{ id: 2, readAt: 1 }, { id: 11, readAt: null }])).toEqual({ current: [11], added: [] });
  });
});
