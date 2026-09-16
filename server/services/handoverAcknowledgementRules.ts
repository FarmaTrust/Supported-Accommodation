export function assertIncomingHandoverCanBeAcknowledged(input: {
  currentShift: { id: number; propertyId: number; assignedUserId: number | null; startsAt: number };
  handover: { propertyId: number; shiftId: number | null; createdBy: number; createdAt: Date };
  userId: number;
}) {
  if (input.currentShift.assignedUserId !== input.userId) {
    throw new Error("Only the worker assigned to this shift can acknowledge its handover notes.");
  }
  if (input.handover.propertyId !== input.currentShift.propertyId) {
    throw new Error("Only a handover for your current property can be acknowledged.");
  }
  if (input.handover.createdBy === input.userId || input.handover.shiftId === input.currentShift.id) {
    throw new Error("You cannot acknowledge a handover from your own current shift.");
  }
  if (input.handover.createdAt.getTime() > input.currentShift.startsAt) {
    throw new Error("Only a previous shift handover can be acknowledged.");
  }
}
