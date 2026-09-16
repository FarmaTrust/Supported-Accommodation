export type ReminderShift = {
  id: number;
  entityId: number;
  propertyId: number;
  assignedUserId: number | null;
  startsAt: number;
  endsAt: number;
  status: string;
};

export type ReminderHandover = {
  id: number;
  entityId: number;
  propertyId: number;
  shiftId: number | null;
  createdBy: number;
  createdAt: number | Date;
};

export type ReminderAcknowledgement = {
  handoverId: number;
  shiftId: number;
  userId: number;
};

export type PendingHandoverReminder = {
  shiftId: number;
  handoverId: number;
  entityId: number;
  propertyId: number;
  recipientUserId: number;
  dedupeKey: string;
};

function timestamp(value: number | Date) {
  return value instanceof Date ? value.getTime() : value;
}

/**
 * Returns only the most recent relevant handovers for a worker whose assigned
 * shift has already started. This is deliberately a narrow decision rule: it
 * never decides access, exposes content, or treats an acknowledgement from a
 * different worker or shift as sufficient.
 */
export function pendingShiftStartHandoverReminders(input: {
  now: number;
  userId: number;
  shifts: ReminderShift[];
  handovers: ReminderHandover[];
  acknowledgements: ReminderAcknowledgement[];
  maxHandoversPerShift?: number;
}): PendingHandoverReminder[] {
  const acknowledged = new Set(input.acknowledgements
    .filter(item => item.userId === input.userId)
    .map(item => `${item.handoverId}:${item.shiftId}:${item.userId}`));
  const limit = input.maxHandoversPerShift ?? 3;

  return input.shifts
    .filter(shift => shift.assignedUserId === input.userId && shift.status !== "cancelled" && shift.startsAt <= input.now && shift.endsAt >= input.now)
    .flatMap(shift => input.handovers
      .filter(handover => handover.entityId === shift.entityId
        && handover.propertyId === shift.propertyId
        && handover.shiftId !== shift.id
        && handover.createdBy !== input.userId
        && timestamp(handover.createdAt) <= shift.startsAt
        && !acknowledged.has(`${handover.id}:${shift.id}:${input.userId}`))
      .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt))
      .slice(0, limit)
      .map(handover => ({
        shiftId: shift.id,
        handoverId: handover.id,
        entityId: shift.entityId,
        propertyId: shift.propertyId,
        recipientUserId: input.userId,
        dedupeKey: `handover-shift-start:${handover.id}:${shift.id}:${input.userId}`,
      })));
}
