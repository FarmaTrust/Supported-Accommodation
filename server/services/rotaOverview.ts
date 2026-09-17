export const ROTA_DAY_MS = 24 * 60 * 60 * 1_000;
export const ROTA_START_HOUR = 6;

export type RotaOverviewShift = {
  id: number;
  propertyId: number;
  propertyName: string;
  assignedUserId: number | null;
  workerName: string | null;
  title: string;
  startsAt: number;
  endsAt: number;
  status: string;
  coverageState: string;
  requiredRole?: string | null;
};

export type RotaCoverageProperty = {
  id: number;
  name: string;
  minimumStaffing: number;
};

export type RotaCoverageGap = {
  key: string;
  propertyId: number;
  propertyName: string;
  startsAt: number;
  endsAt: number;
  requiredStaffing: number;
  allocatedStaffing: number;
  deficit: number;
  relatedShiftIds: number[];
};

type RotaGroup = {
  kind: "working_together" | "close_overlap";
  propertyId: number;
  propertyName: string;
  startsAt: number;
  endsAt: number;
  workerNames: string[];
  shiftIds: number[];
};

export function isShiftWithinRotaDay(shift: Pick<RotaOverviewShift, "startsAt" | "endsAt">, rotaDayStart: number) {
  return shift.startsAt < rotaDayStart + ROTA_DAY_MS && shift.endsAt > rotaDayStart;
}

export function timelinePosition(shift: Pick<RotaOverviewShift, "startsAt" | "endsAt">, rotaDayStart: number) {
  const start = Math.max(shift.startsAt, rotaDayStart);
  const end = Math.min(shift.endsAt, rotaDayStart + ROTA_DAY_MS);
  return {
    offsetPercent: ((start - rotaDayStart) / ROTA_DAY_MS) * 100,
    widthPercent: Math.max(((end - start) / ROTA_DAY_MS) * 100, 0),
  };
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function groupsFor(shifts: RotaOverviewShift[]) {
  const assigned = shifts.filter(shift => shift.assignedUserId !== null);
  const groups: RotaGroup[] = [];
  const exactGroups = new Map<string, RotaOverviewShift[]>();
  for (const shift of assigned) {
    const key = `${shift.propertyId}:${shift.startsAt}:${shift.endsAt}`;
    exactGroups.set(key, [...(exactGroups.get(key) ?? []), shift]);
  }
  for (const group of Array.from(exactGroups.values())) {
    if (unique(group.map(shift => shift.assignedUserId!)).length < 2) continue;
    groups.push({
      kind: "working_together",
      propertyId: group[0]!.propertyId,
      propertyName: group[0]!.propertyName,
      startsAt: group[0]!.startsAt,
      endsAt: group[0]!.endsAt,
      workerNames: unique(group.map(shift => shift.workerName ?? `Key Worker ${shift.assignedUserId}`)),
      shiftIds: group.map(shift => shift.id),
    });
  }
  for (let index = 0; index < assigned.length; index += 1) {
    for (let comparison = index + 1; comparison < assigned.length; comparison += 1) {
      const left = assigned[index]!;
      const right = assigned[comparison]!;
      if (left.propertyId !== right.propertyId || left.assignedUserId === right.assignedUserId) continue;
      const overlapStart = Math.max(left.startsAt, right.startsAt);
      const overlapEnd = Math.min(left.endsAt, right.endsAt);
      const overlap = overlapEnd - overlapStart;
      if (overlap <= 0 || overlap > 2 * 60 * 60 * 1_000) continue;
      if (left.startsAt === right.startsAt && left.endsAt === right.endsAt) continue;
      groups.push({
        kind: "close_overlap",
        propertyId: left.propertyId,
        propertyName: left.propertyName,
        startsAt: overlapStart,
        endsAt: overlapEnd,
        workerNames: unique([left.workerName ?? `Key Worker ${left.assignedUserId}`, right.workerName ?? `Key Worker ${right.assignedUserId}`]),
        shiftIds: [left.id, right.id],
      });
    }
  }
  return groups.sort((left, right) => left.startsAt - right.startsAt);
}

/**
 * Calculates the uncovered intervals for a property in one 06:00–06:00 operating day.
 * Unlike a count of open shift rows, this detects time with no staffed record at all.
 */
export function calculateCoverageGaps(input: {
  rotaDayStart: number;
  property: RotaCoverageProperty;
  shifts: RotaOverviewShift[];
}): RotaCoverageGap[] {
  const rotaDayEnd = input.rotaDayStart + ROTA_DAY_MS;
  const propertyShifts = input.shifts.filter(shift => shift.propertyId === input.property.id && shift.status !== "cancelled" && isShiftWithinRotaDay(shift, input.rotaDayStart));
  const boundaries = unique([
    input.rotaDayStart,
    rotaDayEnd,
    ...propertyShifts.flatMap(shift => [Math.max(input.rotaDayStart, shift.startsAt), Math.min(rotaDayEnd, shift.endsAt)]),
  ]).sort((left, right) => left - right);
  const raw: Omit<RotaCoverageGap, "key">[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startsAt = boundaries[index]!;
    const endsAt = boundaries[index + 1]!;
    if (endsAt <= startsAt) continue;
    const active = propertyShifts.filter(shift => shift.startsAt < endsAt && shift.endsAt > startsAt);
    const allocatedStaffing = new Set(active.flatMap(shift => shift.assignedUserId === null ? [] : [shift.assignedUserId])).size;
    const deficit = Math.max(0, input.property.minimumStaffing - allocatedStaffing);
    if (!deficit) continue;
    const previous = raw.at(-1);
    if (previous && previous.endsAt === startsAt && previous.allocatedStaffing === allocatedStaffing && previous.deficit === deficit) {
      previous.endsAt = endsAt;
      previous.relatedShiftIds = unique([...previous.relatedShiftIds, ...active.map(shift => shift.id)]);
    } else {
      raw.push({
        propertyId: input.property.id,
        propertyName: input.property.name,
        startsAt,
        endsAt,
        requiredStaffing: input.property.minimumStaffing,
        allocatedStaffing,
        deficit,
        relatedShiftIds: active.map(shift => shift.id),
      });
    }
  }

  return raw.map(gap => ({ ...gap, key: `${gap.propertyId}:${gap.startsAt}:${gap.endsAt}:${gap.deficit}` }));
}

export function buildRotaOverview(input: { rotaDayStart: number; shifts: RotaOverviewShift[]; properties?: RotaCoverageProperty[] }) {
  const shifts = input.shifts
    .filter(shift => shift.status !== "cancelled" && isShiftWithinRotaDay(shift, input.rotaDayStart))
    .sort((left, right) => left.startsAt - right.startsAt || left.propertyName.localeCompare(right.propertyName));
  const invalidWindows = shifts.filter(shift => !Number.isFinite(shift.startsAt) || !Number.isFinite(shift.endsAt) || shift.endsAt <= shift.startsAt).map(shift => shift.id);
  const workerOverlapShiftIds = new Set<number>();
  const assignedByWorker = new Map<number, RotaOverviewShift[]>();
  for (const shift of shifts) {
    if (shift.assignedUserId === null) continue;
    assignedByWorker.set(shift.assignedUserId, [...(assignedByWorker.get(shift.assignedUserId) ?? []), shift]);
  }
  for (const workerShifts of Array.from(assignedByWorker.values())) {
    for (let index = 0; index < workerShifts.length; index += 1) {
      for (let comparison = index + 1; comparison < workerShifts.length; comparison += 1) {
        const left = workerShifts[index]!;
        const right = workerShifts[comparison]!;
        if (left.startsAt < right.endsAt && right.startsAt < left.endsAt) {
          workerOverlapShiftIds.add(left.id);
          workerOverlapShiftIds.add(right.id);
        }
      }
    }
  }
  const properties = input.properties ?? Array.from(new Map(shifts.map(shift => [shift.propertyId, { id: shift.propertyId, name: shift.propertyName, minimumStaffing: 1 }])).values());
  const colleagues = Array.from(new Map(shifts.filter(shift => shift.assignedUserId !== null).map(shift => [shift.assignedUserId!, { id: shift.assignedUserId!, name: shift.workerName ?? `Key Worker ${shift.assignedUserId}` }])).values());
  const coverageGaps = properties.flatMap(property => calculateCoverageGaps({ rotaDayStart: input.rotaDayStart, property, shifts }));
  const coverage = {
    total: shifts.length,
    covered: shifts.filter(shift => shift.assignedUserId !== null && shift.coverageState === "covered").length,
    atRisk: shifts.filter(shift => shift.coverageState === "at_risk").length,
    uncovered: coverageGaps.length,
    missingMinutes: coverageGaps.reduce((total, gap) => total + Math.round(((gap.endsAt - gap.startsAt) / 60_000) * gap.deficit), 0),
  };
  const propertySummary = properties.map(property => {
    const propertyShifts = shifts.filter(shift => shift.propertyId === property.id);
    const gaps = coverageGaps.filter(gap => gap.propertyId === property.id);
    return {
      ...property,
      total: propertyShifts.length,
      covered: propertyShifts.filter(shift => shift.assignedUserId !== null && shift.coverageState === "covered").length,
      atRisk: propertyShifts.filter(shift => shift.coverageState === "at_risk").length,
      uncovered: gaps.length,
      missingMinutes: gaps.reduce((total, gap) => total + Math.round(((gap.endsAt - gap.startsAt) / 60_000) * gap.deficit), 0),
    };
  });
  const integrity = {
    state: invalidWindows.length || workerOverlapShiftIds.size ? "needs_review" as const : "checked" as const,
    invalidWindowShiftIds: invalidWindows,
    overlappingShiftIds: Array.from(workerOverlapShiftIds),
  };
  return {
    rotaDayStart: input.rotaDayStart,
    rotaDayEnd: input.rotaDayStart + ROTA_DAY_MS,
    shifts,
    properties,
    colleagues,
    coverage,
    coverageGaps,
    propertySummary,
    groups: groupsFor(shifts),
    integrity,
  };
}
