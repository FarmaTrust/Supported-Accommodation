export type AttendanceReminderShift = {
  id: number;
  entityId: number;
  propertyId: number;
  assignedUserId: number | null;
  startsAt: number;
  endsAt: number;
  status: string;
};

export type AttendanceClockEvent = {
  shiftId: number | null;
  eventType: "clock_in" | "clock_out" | "adjustment";
};

export type AttendanceReminder = {
  entityId: number;
  propertyId: number;
  recipientUserId: number;
  shiftId: number;
  eventType: "clock_in" | "clock_out";
  title: string;
  message: string;
  dueAt: number;
  dedupeKey: string;
};

const REMINDER_WINDOW_MS = 30 * 60_000;

/**
 * Creates in-app attendance reminders only while the signed-in worker is near
 * the scheduled start or end of their own assigned shift. The caller is
 * responsible for persisting the notification idempotently.
 */
export function dueShiftAttendanceReminders(input: {
  now: number;
  userId: number;
  shifts: AttendanceReminderShift[];
  clockEvents: AttendanceClockEvent[];
}): AttendanceReminder[] {
  const clockedIn = new Set(input.clockEvents.filter(event => event.eventType === "clock_in" && event.shiftId).map(event => event.shiftId!));
  const clockedOut = new Set(input.clockEvents.filter(event => event.eventType === "clock_out" && event.shiftId).map(event => event.shiftId!));
  const reminders: AttendanceReminder[] = [];

  for (const shift of input.shifts) {
    if (shift.assignedUserId !== input.userId || !["assigned", "confirmed", "in_progress"].includes(shift.status)) continue;
    if (!clockedIn.has(shift.id) && input.now >= shift.startsAt - REMINDER_WINDOW_MS && input.now <= shift.startsAt + REMINDER_WINDOW_MS) {
      reminders.push({
        entityId: shift.entityId,
        propertyId: shift.propertyId,
        recipientUserId: input.userId,
        shiftId: shift.id,
        eventType: "clock_in",
        title: "Clock in for your shift",
        message: "Your assigned shift is starting. Record attendance before continuing with operational tasks.",
        dueAt: shift.startsAt,
        dedupeKey: `shift-attendance:${shift.id}:${input.userId}:clock-in`,
      });
    }
    if (clockedIn.has(shift.id) && !clockedOut.has(shift.id) && input.now >= shift.endsAt - REMINDER_WINDOW_MS && input.now <= shift.endsAt + REMINDER_WINDOW_MS) {
      reminders.push({
        entityId: shift.entityId,
        propertyId: shift.propertyId,
        recipientUserId: input.userId,
        shiftId: shift.id,
        eventType: "clock_out",
        title: "Clock out at shift end",
        message: "Your assigned shift is ending. Record clock-out once your handover and duties are complete.",
        dueAt: shift.endsAt,
        dedupeKey: `shift-attendance:${shift.id}:${input.userId}:clock-out`,
      });
    }
  }
  return reminders;
}

export function shiftAttendanceReminderDedupeKey(shiftId: number, userId: number, eventType: "clock_in" | "clock_out") {
  return `shift-attendance:${shiftId}:${userId}:${eventType === "clock_in" ? "clock-in" : "clock-out"}`;
}
