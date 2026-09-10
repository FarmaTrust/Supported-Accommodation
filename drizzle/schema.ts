import {
  bigint,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  operationalRole: mysqlEnum("operationalRole", [
    "platform_admin",
    "owner",
    "registered_manager",
    "support_worker",
    "hr_compliance",
    "finance",
    "read_only",
  ]).default("support_worker").notNull(),
  accountStatus: mysqlEnum("accountStatus", ["invited", "active", "suspended"])
    .default("active")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const entities = mysqlTable(
  "entities",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    legalName: varchar("legalName", { length: 220 }).notNull(),
    companyNumber: varchar("companyNumber", { length: 32 }),
    ofstedUrn: varchar("ofstedUrn", { length: 64 }),
    vatNumber: varchar("vatNumber", { length: 32 }),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 320 }),
    supportContactName: varchar("supportContactName", { length: 180 }),
    supportEmail: varchar("supportEmail", { length: 320 }),
    supportPhone: varchar("supportPhone", { length: 40 }),
    supportGuidance: text("supportGuidance"),
    addressLine1: varchar("addressLine1", { length: 180 }),
    addressLine2: varchar("addressLine2", { length: 180 }),
    city: varchar("city", { length: 120 }),
    postcode: varchar("postcode", { length: 16 }),
    invoicePrefix: varchar("invoicePrefix", { length: 12 }).default("INV").notNull(),
    nextInvoiceNumber: int("nextInvoiceNumber").default(1).notNull(),
    defaultVatRate: decimal("defaultVatRate", { precision: 5, scale: 2 }).default("0.00").notNull(),
    bankAccountName: varchar("bankAccountName", { length: 180 }),
    bankSortCodeCiphertext: text("bankSortCodeCiphertext"),
    bankAccountNumberCiphertext: text("bankAccountNumberCiphertext"),
    bankDetailsUpdatedAt: bigint("bankDetailsUpdatedAt", { mode: "number" }),
    bankDetailsUpdatedBy: int("bankDetailsUpdatedBy").references(() => users.id),
    status: mysqlEnum("status", ["draft", "active", "inactive"]).default("draft").notNull(),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("entities_status_idx").on(table.status), uniqueIndex("entities_legal_name_uq").on(table.legalName)],
);

export const entityMemberships = mysqlTable(
  "entityMemberships",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    userId: int("userId").notNull().references(() => users.id),
    operationalRole: mysqlEnum("operationalRole", [
      "owner",
      "registered_manager",
      "support_worker",
      "hr_compliance",
      "finance",
      "read_only",
    ]).notNull(),
    allProperties: int("allProperties").default(0).notNull(),
    extraCapabilities: json("extraCapabilities").$type<string[]>(),
    status: mysqlEnum("status", ["active", "suspended", "ended"]).default("active").notNull(),
    startsAt: bigint("startsAt", { mode: "number" }),
    endsAt: bigint("endsAt", { mode: "number" }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("entity_membership_uq").on(table.entityId, table.userId),
    index("entity_membership_user_idx").on(table.userId, table.status),
  ],
);

export const properties = mysqlTable(
  "properties",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    name: varchar("name", { length: 160 }).notNull(),
    addressLine1: varchar("addressLine1", { length: 180 }).notNull(),
    addressLine2: varchar("addressLine2", { length: 180 }),
    city: varchar("city", { length: 120 }).notNull(),
    postcode: varchar("postcode", { length: 16 }).notNull(),
    accommodationType: mysqlEnum("accommodationType", [
      "single_occupancy",
      "ring_fenced_shared",
      "non_ring_fenced_shared",
      "supported_lodgings",
      "other",
    ]).default("single_occupancy").notNull(),
    ofstedSettingReference: varchar("ofstedSettingReference", { length: 80 }),
    capacity: int("capacity").default(1).notNull(),
    occupiedBeds: int("occupiedBeds").default(0).notNull(),
    minimumStaffing: int("minimumStaffing").default(1).notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    geofenceRadiusMetres: int("geofenceRadiusMetres").default(150).notNull(),
    managerUserId: int("managerUserId").references(() => users.id),
    status: mysqlEnum("status", ["onboarding", "active", "paused", "closed"]).default("onboarding").notNull(),
    lastLocationAssessmentAt: bigint("lastLocationAssessmentAt", { mode: "number" }),
    nextLocationAssessmentDueAt: bigint("nextLocationAssessmentDueAt", { mode: "number" }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("properties_entity_status_idx").on(table.entityId, table.status)],
);

export const propertyAssignments = mysqlTable(
  "propertyAssignments",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    userId: int("userId").notNull().references(() => users.id),
    assignmentType: mysqlEnum("assignmentType", ["manager", "worker", "finance", "compliance", "viewer"]).notNull(),
    startsAt: bigint("startsAt", { mode: "number" }),
    endsAt: bigint("endsAt", { mode: "number" }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("property_assignment_uq").on(table.propertyId, table.userId, table.assignmentType)],
);

export const propertyUnits = mysqlTable(
  "propertyUnits",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    label: varchar("label", { length: 100 }).notNull(),
    unitType: mysqlEnum("unitType", ["bedroom", "self_contained", "lodgings_room", "other"]).default("bedroom").notNull(),
    capacity: int("capacity").default(1).notNull(),
    status: mysqlEnum("status", ["available", "occupied", "reserved", "maintenance", "inactive"]).default("available").notNull(),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("property_unit_label_uq").on(table.propertyId, table.label)],
);

export const occupancyEvents = mysqlTable(
  "occupancyEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    unitId: int("unitId").references(() => propertyUnits.id),
    placementId: int("placementId").references(() => placements.id),
    eventType: mysqlEnum("eventType", ["reserved", "move_in", "move_out", "made_available", "maintenance_start", "maintenance_end"]).notNull(),
    effectiveAt: bigint("effectiveAt", { mode: "number" }).notNull(),
    reason: text("reason"),
    createdBy: int("createdBy").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("occupancy_property_time_idx").on(table.propertyId, table.effectiveAt)],
);

export const localAuthorities = mysqlTable(
  "localAuthorities",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    name: varchar("name", { length: 220 }).notNull(),
    addressLine1: varchar("addressLine1", { length: 180 }),
    addressLine2: varchar("addressLine2", { length: 180 }),
    city: varchar("city", { length: 120 }),
    postcode: varchar("postcode", { length: 16 }),
    financeEmail: varchar("financeEmail", { length: 320 }),
    placementEmail: varchar("placementEmail", { length: 320 }),
    paymentTermsDays: int("paymentTermsDays").default(30).notNull(),
    defaultPurchaseOrderRequired: int("defaultPurchaseOrderRequired").default(0).notNull(),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("authority_entity_name_uq").on(table.entityId, table.name)],
);

export const staffProfiles = mysqlTable(
  "staffProfiles",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    userId: int("userId").references(() => users.id),
    employeeNumber: varchar("employeeNumber", { length: 40 }),
    fullName: varchar("fullName", { length: 180 }).notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 40 }),
    jobTitle: varchar("jobTitle", { length: 160 }).notNull(),
    employmentType: mysqlEnum("employmentType", ["permanent", "fixed_term", "casual", "agency", "volunteer"]).default("permanent").notNull(),
    startDate: bigint("startDate", { mode: "number" }),
    endDate: bigint("endDate", { mode: "number" }),
    managerUserId: int("managerUserId").references(() => users.id),
    status: mysqlEnum("status", ["onboarding", "active", "leave", "ended"]).default("onboarding").notNull(),
    emergencyContactName: varchar("emergencyContactName", { length: 180 }),
    emergencyContactPhone: varchar("emergencyContactPhone", { length: 40 }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("staff_entity_status_idx").on(table.entityId, table.status),
    uniqueIndex("staff_entity_number_uq").on(table.entityId, table.employeeNumber),
  ],
);

export const workforceChecks = mysqlTable(
  "workforceChecks",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    staffProfileId: int("staffProfileId").notNull().references(() => staffProfiles.id),
    checkType: mysqlEnum("checkType", [
      "identity",
      "dbs",
      "right_to_work",
      "reference",
      "employment_gap",
      "qualification",
      "training",
      "induction",
      "probation",
      "supervision",
      "appraisal",
      "policy_acknowledgement",
    ]).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    reference: varchar("reference", { length: 160 }),
    level: varchar("level", { length: 120 }),
    issuedAt: bigint("issuedAt", { mode: "number" }),
    expiresAt: bigint("expiresAt", { mode: "number" }),
    verifiedAt: bigint("verifiedAt", { mode: "number" }),
    verifiedBy: int("verifiedBy").references(() => users.id),
    status: mysqlEnum("status", ["missing", "pending", "valid", "expiring", "expired", "rejected", "not_applicable"])
      .default("pending")
      .notNull(),
    evidenceDocumentId: int("evidenceDocumentId"),
    notes: text("notes"),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("workforce_check_due_idx").on(table.entityId, table.expiresAt, table.status)],
);

export const youngPeople = mysqlTable(
  "youngPeople",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    reference: varchar("reference", { length: 64 }).notNull(),
    preferredName: varchar("preferredName", { length: 120 }),
    dateOfBirth: bigint("dateOfBirth", { mode: "number" }),
    pronouns: varchar("pronouns", { length: 80 }),
    status: mysqlEnum("status", ["referral", "matching", "placed", "transitioning", "closed"]).default("referral").notNull(),
    privacyNoticeVersion: varchar("privacyNoticeVersion", { length: 40 }),
    privacyNoticeAcknowledgedAt: bigint("privacyNoticeAcknowledgedAt", { mode: "number" }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("young_person_reference_uq").on(table.entityId, table.reference)],
);

export const placements = mysqlTable(
  "placements",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    youngPersonId: int("youngPersonId").notNull().references(() => youngPeople.id),
    propertyId: int("propertyId").references(() => properties.id),
    localAuthorityId: int("localAuthorityId").references(() => localAuthorities.id),
    status: mysqlEnum("status", ["referred", "assessment", "matched", "accepted", "active", "notice", "ended", "declined"])
      .default("referred")
      .notNull(),
    placementBasis: mysqlEnum("placementBasis", ["section_22c_6_d", "section_23b_8_b", "other"]),
    careOrderStatus: mysqlEnum("careOrderStatus", ["none", "care_order", "supervision_order", "interim_care_order", "unknown"])
      .default("unknown")
      .notNull(),
    referralReceivedAt: bigint("referralReceivedAt", { mode: "number" }),
    startAt: bigint("startAt", { mode: "number" }),
    expectedEndAt: bigint("expectedEndAt", { mode: "number" }),
    endedAt: bigint("endedAt", { mode: "number" }),
    reviewDueAt: bigint("reviewDueAt", { mode: "number" }),
    purchaseOrderNumber: varchar("purchaseOrderNumber", { length: 100 }),
    hasEhcPlan: int("hasEhcPlan").default(0).notNull(),
    iroName: varchar("iroName", { length: 180 }),
    iroEmail: varchar("iroEmail", { length: 320 }),
    personalAdviserName: varchar("personalAdviserName", { length: 180 }),
    personalAdviserEmail: varchar("personalAdviserEmail", { length: 320 }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("placement_property_status_idx").on(table.entityId, table.propertyId, table.status)],
);

export const workerAssignments = mysqlTable(
  "workerAssignments",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    placementId: int("placementId").notNull().references(() => placements.id),
    userId: int("userId").notNull().references(() => users.id),
    assignmentRole: mysqlEnum("assignmentRole", ["key_worker", "co_worker", "manager", "oversight"]).notNull(),
    startsAt: bigint("startsAt", { mode: "number" }),
    endsAt: bigint("endsAt", { mode: "number" }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("worker_assignment_uq").on(table.placementId, table.userId, table.assignmentRole)],
);

export const carePlans = mysqlTable(
  "carePlans",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    placementId: int("placementId").notNull().references(() => placements.id),
    planType: mysqlEnum("planType", ["support", "pathway", "risk", "safety", "placement", "transition"]).notNull(),
    version: int("version").default(1).notNull(),
    status: mysqlEnum("status", ["draft", "in_review", "approved", "superseded"]).default("draft").notNull(),
    summary: text("summary"),
    content: json("content").$type<Record<string, unknown>>(),
    reviewDueAt: bigint("reviewDueAt", { mode: "number" }),
    approvedAt: bigint("approvedAt", { mode: "number" }),
    approvedBy: int("approvedBy").references(() => users.id),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("care_plan_review_idx").on(table.entityId, table.reviewDueAt, table.status)],
);

export const shifts = mysqlTable(
  "shifts",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    assignedUserId: int("assignedUserId").references(() => users.id),
    title: varchar("title", { length: 140 }).default("Support shift").notNull(),
    startsAt: bigint("startsAt", { mode: "number" }).notNull(),
    endsAt: bigint("endsAt", { mode: "number" }).notNull(),
    requiredRole: varchar("requiredRole", { length: 120 }),
    status: mysqlEnum("status", ["draft", "open", "assigned", "confirmed", "in_progress", "completed", "cancelled"])
      .default("draft")
      .notNull(),
    coverageState: mysqlEnum("coverageState", ["covered", "at_risk", "uncovered"]).default("uncovered").notNull(),
    notes: text("notes"),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("shift_property_time_idx").on(table.propertyId, table.startsAt, table.status)],
);

export const shiftRequests = mysqlTable(
  "shiftRequests",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    shiftId: int("shiftId").notNull().references(() => shifts.id),
    requestType: mysqlEnum("requestType", ["claim", "swap", "release", "cancel"]).notNull(),
    requestedBy: int("requestedBy").notNull().references(() => users.id),
    proposedUserId: int("proposedUserId").references(() => users.id),
    reason: text("reason"),
    status: mysqlEnum("status", ["pending", "approved", "declined", "withdrawn"]).default("pending").notNull(),
    reviewedBy: int("reviewedBy").references(() => users.id),
    reviewedAt: bigint("reviewedAt", { mode: "number" }),
    reviewNotes: text("reviewNotes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("shift_request_status_idx").on(table.entityId, table.status, table.createdAt)],
);

export const timesheets = mysqlTable(
  "timesheets",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    userId: int("userId").notNull().references(() => users.id),
    periodStart: bigint("periodStart", { mode: "number" }).notNull(),
    periodEnd: bigint("periodEnd", { mode: "number" }).notNull(),
    totalMinutes: int("totalMinutes").default(0).notNull(),
    status: mysqlEnum("status", ["draft", "submitted", "approved", "returned", "exported"]).default("draft").notNull(),
    submittedAt: bigint("submittedAt", { mode: "number" }),
    approvedAt: bigint("approvedAt", { mode: "number" }),
    approvedBy: int("approvedBy").references(() => users.id),
    exportReference: varchar("exportReference", { length: 120 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("timesheet_period_uq").on(table.entityId, table.userId, table.periodStart, table.periodEnd)],
);

export const timesheetEntries = mysqlTable(
  "timesheetEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    timesheetId: int("timesheetId").notNull().references(() => timesheets.id),
    shiftId: int("shiftId").references(() => shifts.id),
    clockInEventId: int("clockInEventId"),
    clockOutEventId: int("clockOutEventId"),
    minutes: int("minutes").notNull(),
    exceptionType: mysqlEnum("exceptionType", ["none", "missing_clock", "off_site", "manual_adjustment", "overlap"]).default("none").notNull(),
    notes: text("notes"),
    originalMinutes: int("originalMinutes"),
    adjustedBy: int("adjustedBy").references(() => users.id),
    adjustedAt: bigint("adjustedAt", { mode: "number" }),
    adjustmentReason: text("adjustmentReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("timesheet_entry_sheet_idx").on(table.timesheetId)],
);

export const clockEvents = mysqlTable(
  "clockEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    shiftId: int("shiftId").references(() => shifts.id),
    userId: int("userId").notNull().references(() => users.id),
    eventType: mysqlEnum("eventType", ["clock_in", "clock_out", "adjustment"]).notNull(),
    occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    accuracyMetres: decimal("accuracyMetres", { precision: 10, scale: 2 }),
    distanceMetres: decimal("distanceMetres", { precision: 10, scale: 2 }),
    locationState: mysqlEnum("locationState", ["on_site", "off_site", "unavailable", "manual"]).notNull(),
    overrideReason: text("overrideReason"),
    approvedBy: int("approvedBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("clock_user_time_idx").on(table.userId, table.occurredAt)],
);

export const handovers = mysqlTable(
  "handovers",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    shiftId: int("shiftId").references(() => shifts.id),
    summary: text("summary").notNull(),
    risks: text("risks"),
    outstandingActions: text("outstandingActions"),
    sensitivity: mysqlEnum("sensitivity", ["operational", "safeguarding", "restricted"]).default("operational").notNull(),
    acknowledgedAt: bigint("acknowledgedAt", { mode: "number" }),
    acknowledgedBy: int("acknowledgedBy").references(() => users.id),
    createdBy: int("createdBy").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("handover_property_idx").on(table.propertyId, table.createdAt)],
);

export const keyWorkerReports = mysqlTable(
  "keyWorkerReports",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    placementId: int("placementId").notNull().references(() => placements.id),
    authorUserId: int("authorUserId").notNull().references(() => users.id),
    reportType: mysqlEnum("reportType", ["daily", "weekly", "monthly_review"]).notNull(),
    reportDate: bigint("reportDate", { mode: "number" }).notNull(),
    mood: varchar("mood", { length: 80 }),
    attitude: varchar("attitude", { length: 120 }),
    discussions: text("discussions"),
    pointsToNote: text("pointsToNote"),
    plan: text("plan"),
    nextReviewAt: bigint("nextReviewAt", { mode: "number" }),
    suggestions: text("suggestions"),
    status: mysqlEnum("status", ["draft", "submitted", "reviewed", "returned", "approved", "locked"]).default("draft").notNull(),
    reviewedBy: int("reviewedBy").references(() => users.id),
    reviewedAt: bigint("reviewedAt", { mode: "number" }),
    reviewNotesCiphertext: text("reviewNotesCiphertext"),
    approvedBy: int("approvedBy").references(() => users.id),
    approvedAt: bigint("approvedAt", { mode: "number" }),
    lockedBy: int("lockedBy").references(() => users.id),
    lockedAt: bigint("lockedAt", { mode: "number" }),
    version: int("version").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("key_report_placement_date_idx").on(table.placementId, table.reportDate)],
);

export const incidents = mysqlTable(
  "incidents",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    placementId: int("placementId").references(() => placements.id),
    category: mysqlEnum("category", [
      "safeguarding",
      "missing",
      "exploitation",
      "police",
      "abuse_allegation",
      "child_protection_enquiry",
      "restraint",
      "health_safety",
      "complaint",
      "other",
    ]).notNull(),
    severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).default("medium").notNull(),
    occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
    summary: varchar("summary", { length: 240 }).notNull(),
    details: text("details").notNull(),
    immediateActions: text("immediateActions"),
    notifiability: mysqlEnum("notifiability", ["unreviewed", "not_notifiable", "regulation_27", "other_notification"])
      .default("unreviewed")
      .notNull(),
    notificationDueAt: bigint("notificationDueAt", { mode: "number" }),
    notificationSubmittedAt: bigint("notificationSubmittedAt", { mode: "number" }),
    notificationRecipients: json("notificationRecipients").$type<string[]>(),
    learning: text("learning"),
    status: mysqlEnum("status", ["open", "under_review", "notified", "follow_up", "closed"]).default("open").notNull(),
    managerReviewState: mysqlEnum("managerReviewState", ["pending", "in_review", "returned", "approved", "closed"]).default("pending").notNull(),
    managerReviewNotesCiphertext: text("managerReviewNotesCiphertext"),
    reviewedBy: int("reviewedBy").references(() => users.id),
    reviewedAt: bigint("reviewedAt", { mode: "number" }),
    version: int("version").default(1).notNull(),
    managerUserId: int("managerUserId").references(() => users.id),
    createdBy: int("createdBy").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("incident_entity_status_idx").on(table.entityId, table.status, table.severity)],
);

export const complianceObligations = mysqlTable(
  "complianceObligations",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").references(() => properties.id),
    staffProfileId: int("staffProfileId").references(() => staffProfiles.id),
    placementId: int("placementId").references(() => placements.id),
    category: mysqlEnum("category", ["property", "workforce", "placement", "policy", "quality", "finance", "data_protection"])
      .notNull(),
    requirementKey: varchar("requirementKey", { length: 120 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    basis: varchar("basis", { length: 220 }),
    ownerUserId: int("ownerUserId").references(() => users.id),
    ownerRole: varchar("ownerRole", { length: 80 }),
    dueAt: bigint("dueAt", { mode: "number" }).notNull(),
    leadDays: int("leadDays").default(30).notNull(),
    recurrence: varchar("recurrence", { length: 80 }),
    status: mysqlEnum("status", ["not_due", "due_soon", "overdue", "complete", "not_applicable", "exception"])
      .default("not_due")
      .notNull(),
    ragStatus: mysqlEnum("ragStatus", ["green", "amber", "red", "grey"]).default("grey").notNull(),
    completedAt: bigint("completedAt", { mode: "number" }),
    evidenceDocumentId: int("evidenceDocumentId"),
    exceptionReason: text("exceptionReason"),
    sourceType: varchar("sourceType", { length: 80 }),
    sourceId: int("sourceId"),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("compliance_due_idx").on(table.entityId, table.dueAt, table.status)],
);

export const workPlanActions = mysqlTable(
  "workPlanActions",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").references(() => properties.id),
    placementId: int("placementId").references(() => placements.id),
    title: varchar("title", { length: 220 }).notNull(),
    description: text("description"),
    sourceType: varchar("sourceType", { length: 80 }),
    sourceId: int("sourceId"),
    ownerUserId: int("ownerUserId").references(() => users.id),
    priority: mysqlEnum("priority", ["low", "normal", "high", "critical"]).default("normal").notNull(),
    dueAt: bigint("dueAt", { mode: "number" }).notNull(),
    status: mysqlEnum("status", ["open", "in_progress", "blocked", "ready_for_review", "complete", "cancelled"])
      .default("open")
      .notNull(),
    progressPercent: int("progressPercent").default(0).notNull(),
    completionNotes: text("completionNotes"),
    evidenceDocumentId: int("evidenceDocumentId"),
    reviewedAt: bigint("reviewedAt", { mode: "number" }),
    reviewedBy: int("reviewedBy").references(() => users.id),
    reviewOutcome: mysqlEnum("reviewOutcome", ["approved", "returned"]),
    reviewNotes: text("reviewNotes"),
    completedAt: bigint("completedAt", { mode: "number" }),
    completedBy: int("completedBy").references(() => users.id),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("work_plan_due_idx").on(table.entityId, table.dueAt, table.status)],
);

export const workPlanDependencies = mysqlTable(
  "workPlanDependencies",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    actionId: int("actionId").notNull().references(() => workPlanActions.id),
    dependsOnActionId: int("dependsOnActionId").notNull().references(() => workPlanActions.id),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("work_plan_dependency_uq").on(table.actionId, table.dependsOnActionId)],
);

export const propertyEvidence = mysqlTable(
  "propertyEvidence",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    recordType: mysqlEnum("recordType", ["certificate", "insurance", "lease", "licence", "contractor", "maintenance", "inventory", "location_assessment", "fire_risk", "gas_safety", "electrical_safety", "water_safety", "other"]).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    providerName: varchar("providerName", { length: 180 }),
    reference: varchar("reference", { length: 160 }),
    issuedAt: bigint("issuedAt", { mode: "number" }),
    dueAt: bigint("dueAt", { mode: "number" }),
    ownerUserId: int("ownerUserId").references(() => users.id),
    status: mysqlEnum("status", ["draft", "valid", "due_soon", "expired", "action_required", "closed"]).default("draft").notNull(),
    details: json("details").$type<Record<string, unknown>>(),
    documentId: int("documentId"),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("property_evidence_due_idx").on(table.entityId, table.propertyId, table.dueAt, table.status)],
);

export const documentFolders = mysqlTable(
  "documentFolders",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    parentFolderId: int("parentFolderId"),
    name: varchar("name", { length: 180 }).notNull(),
    classification: mysqlEnum("classification", ["general", "hr", "finance", "safeguarding", "bank", "restricted"]).default("general").notNull(),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("document_folder_name_uq").on(table.entityId, table.parentFolderId, table.name)],
);

export const documents = mysqlTable(
  "documents",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").references(() => properties.id),
    folderId: int("folderId").references(() => documentFolders.id),
    title: varchar("title", { length: 240 }).notNull(),
    documentType: mysqlEnum("documentType", ["policy", "template", "certificate", "contract", "plan", "evidence", "generated", "other"])
      .notNull(),
    classification: mysqlEnum("classification", ["general", "hr", "finance", "safeguarding", "bank", "restricted"])
      .default("general")
      .notNull(),
    status: mysqlEnum("status", ["draft", "in_review", "approved", "superseded", "archived"]).default("draft").notNull(),
    currentVersion: int("currentVersion").default(1).notNull(),
    reviewDueAt: bigint("reviewDueAt", { mode: "number" }),
    retentionUntil: bigint("retentionUntil", { mode: "number" }),
    retentionBasis: varchar("retentionBasis", { length: 220 }),
    legalHold: int("legalHold").default(0).notNull(),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("documents_entity_status_idx").on(table.entityId, table.status, table.documentType)],
);

export const documentVersions = mysqlTable(
  "documentVersions",
  {
    id: int("id").autoincrement().primaryKey(),
    documentId: int("documentId").notNull().references(() => documents.id),
    version: int("version").notNull(),
    fileKey: varchar("fileKey", { length: 500 }),
    fileUrl: text("fileUrl"),
    fileName: varchar("fileName", { length: 300 }),
    mimeType: varchar("mimeType", { length: 160 }),
    sizeBytes: bigint("sizeBytes", { mode: "number" }),
    contentHash: varchar("contentHash", { length: 128 }),
    scanStatus: mysqlEnum("scanStatus", ["pending", "not_available", "clean", "quarantined"]).default("pending").notNull(),
    changeSummary: text("changeSummary"),
    approvedAt: bigint("approvedAt", { mode: "number" }),
    approvedBy: int("approvedBy").references(() => users.id),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("document_version_uq").on(table.documentId, table.version)],
);

export const documentTemplates = mysqlTable(
  "documentTemplates",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").references(() => entities.id),
    templateKey: varchar("templateKey", { length: 100 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    category: mysqlEnum("category", ["provider_pack", "support_plan", "pathway_plan", "risk_assessment", "incident_notification", "supervision", "placement_commencement", "inspection_export", "other"]).notNull(),
    version: int("version").default(1).notNull(),
    fieldSchema: json("fieldSchema").$type<Record<string, unknown>>(),
    bodyTemplate: text("bodyTemplate").notNull(),
    status: mysqlEnum("status", ["draft", "active", "superseded", "archived"]).default("active").notNull(),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("document_template_version_uq").on(table.entityId, table.templateKey, table.version)],
);

export const retentionReviews = mysqlTable(
  "retentionReviews",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    resourceType: varchar("resourceType", { length: 80 }).notNull(),
    resourceId: int("resourceId").notNull(),
    classification: mysqlEnum("classification", ["general", "hr", "finance", "safeguarding", "bank", "restricted"]).notNull(),
    retentionBasis: varchar("retentionBasis", { length: 240 }).notNull(),
    retentionUntil: bigint("retentionUntil", { mode: "number" }).notNull(),
    reviewDueAt: bigint("reviewDueAt", { mode: "number" }).notNull(),
    legalHold: int("legalHold").default(0).notNull(),
    status: mysqlEnum("status", ["pending", "hold", "approved_delete", "approved_transfer", "completed", "cancelled"]).default("pending").notNull(),
    requestedBy: int("requestedBy").references(() => users.id),
    approvedBy: int("approvedBy").references(() => users.id),
    decisionAt: bigint("decisionAt", { mode: "number" }),
    decisionNotes: text("decisionNotes"),
    completedAt: bigint("completedAt", { mode: "number" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("retention_review_due_idx").on(table.entityId, table.reviewDueAt, table.status)],
);

export const exportJobs = mysqlTable(
  "exportJobs",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").references(() => properties.id),
    exportType: mysqlEnum("exportType", ["inspection", "subject_access", "record_transfer", "finance", "audit", "custom"]).notNull(),
    scope: json("scope").$type<Record<string, unknown>>().notNull(),
    redaction: json("redaction").$type<Record<string, unknown>>(),
    manifest: json("manifest").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", ["queued", "generating", "ready", "failed", "expired"]).default("queued").notNull(),
    documentId: int("documentId").references(() => documents.id),
    requestedBy: int("requestedBy").notNull().references(() => users.id),
    completedAt: bigint("completedAt", { mode: "number" }),
    expiresAt: bigint("expiresAt", { mode: "number" }),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("export_jobs_status_idx").on(table.entityId, table.status, table.createdAt)],
);

export const policyAcknowledgements = mysqlTable(
  "policyAcknowledgements",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    documentId: int("documentId").notNull().references(() => documents.id),
    documentVersion: int("documentVersion").notNull(),
    userId: int("userId").notNull().references(() => users.id),
    dueAt: bigint("dueAt", { mode: "number" }),
    acknowledgedAt: bigint("acknowledgedAt", { mode: "number" }),
    status: mysqlEnum("status", ["pending", "acknowledged", "overdue", "exempt"]).default("pending").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("policy_ack_uq").on(table.documentId, table.documentVersion, table.userId)],
);

export const feeSchedules = mysqlTable(
  "feeSchedules",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    localAuthorityId: int("localAuthorityId").references(() => localAuthorities.id),
    propertyId: int("propertyId").references(() => properties.id),
    placementType: varchar("placementType", { length: 120 }),
    contractReference: varchar("contractReference", { length: 160 }),
    name: varchar("name", { length: 180 }).notNull(),
    billingUnit: mysqlEnum("billingUnit", ["daily", "weekly", "four_week", "monthly", "fixed"]).default("four_week").notNull(),
    rate: decimal("rate", { precision: 12, scale: 2 }).notNull(),
    vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("0.00").notNull(),
    vatTreatment: mysqlEnum("vatTreatment", ["standard", "reduced", "zero", "exempt", "outside_scope"]).default("exempt").notNull(),
    effectiveFrom: bigint("effectiveFrom", { mode: "number" }).notNull(),
    effectiveTo: bigint("effectiveTo", { mode: "number" }),
    status: mysqlEnum("status", ["draft", "active", "expired"]).default("draft").notNull(),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("fee_schedule_effective_idx").on(table.entityId, table.effectiveFrom, table.status)],
);

export const invoices = mysqlTable(
  "invoices",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    localAuthorityId: int("localAuthorityId").notNull().references(() => localAuthorities.id),
    placementId: int("placementId").references(() => placements.id),
    invoiceNumber: varchar("invoiceNumber", { length: 64 }),
    invoiceDate: bigint("invoiceDate", { mode: "number" }).notNull(),
    supplyDate: bigint("supplyDate", { mode: "number" }),
    periodStart: bigint("periodStart", { mode: "number" }).notNull(),
    periodEnd: bigint("periodEnd", { mode: "number" }).notNull(),
    dueAt: bigint("dueAt", { mode: "number" }),
    purchaseOrderNumber: varchar("purchaseOrderNumber", { length: 100 }),
    youngPersonReferenceSnapshot: varchar("youngPersonReferenceSnapshot", { length: 64 }),
    customerNameSnapshot: varchar("customerNameSnapshot", { length: 220 }),
    customerAddressSnapshot: text("customerAddressSnapshot"),
    supplierSnapshot: json("supplierSnapshot").$type<Record<string, unknown>>(),
    bankDetailsSnapshotCiphertext: text("bankDetailsSnapshotCiphertext"),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 }).default("0.00").notNull(),
    vatTotal: decimal("vatTotal", { precision: 12, scale: 2 }).default("0.00").notNull(),
    total: decimal("total", { precision: 12, scale: 2 }).default("0.00").notNull(),
    amountPaid: decimal("amountPaid", { precision: 12, scale: 2 }).default("0.00").notNull(),
    status: mysqlEnum("status", ["draft", "pending_approval", "issued", "sent", "part_paid", "paid", "overdue", "disputed", "void", "credited"])
      .default("draft")
      .notNull(),
    approvalRequestedAt: bigint("approvalRequestedAt", { mode: "number" }),
    approvedAt: bigint("approvedAt", { mode: "number" }),
    approvedBy: int("approvedBy").references(() => users.id),
    issuedAt: bigint("issuedAt", { mode: "number" }),
    issuedBy: int("issuedBy").references(() => users.id),
    sentAt: bigint("sentAt", { mode: "number" }),
    deliveryMethod: mysqlEnum("deliveryMethod", ["secure_link", "email", "portal", "manual"]),
    deliveryReference: varchar("deliveryReference", { length: 220 }),
    disputeOpenedAt: bigint("disputeOpenedAt", { mode: "number" }),
    disputeResolvedAt: bigint("disputeResolvedAt", { mode: "number" }),
    reconciliationStatus: mysqlEnum("reconciliationStatus", ["unreconciled", "part_reconciled", "reconciled", "exception"]).default("unreconciled").notNull(),
    pdfDocumentId: int("pdfDocumentId").references(() => documents.id),
    notes: text("notes"),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("invoice_number_uq").on(table.entityId, table.invoiceNumber),
    index("invoice_due_status_idx").on(table.entityId, table.dueAt, table.status),
  ],
);

export const statementArchives = mysqlTable(
  "statementArchives",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    localAuthorityId: int("localAuthorityId").references(() => localAuthorities.id),
    documentId: int("documentId").notNull().references(() => documents.id),
    generatedBy: int("generatedBy").notNull().references(() => users.id),
    startAt: bigint("startAt", { mode: "number" }).notNull(),
    endAt: bigint("endAt", { mode: "number" }).notNull(),
    openingBalance: decimal("openingBalance", { precision: 12, scale: 2 }).notNull(),
    closingBalance: decimal("closingBalance", { precision: 12, scale: 2 }).notNull(),
    contentHash: varchar("contentHash", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("statement_archive_document_uq").on(table.documentId),
    index("statement_archive_entity_created_idx").on(table.entityId, table.createdAt),
    index("statement_archive_authority_period_idx").on(table.entityId, table.localAuthorityId, table.startAt, table.endAt),
  ],
);

export const invoiceLines = mysqlTable(
  "invoiceLines",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceId: int("invoiceId").notNull().references(() => invoices.id),
    feeScheduleId: int("feeScheduleId").references(() => feeSchedules.id),
    description: varchar("description", { length: 300 }).notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 3 }).default("1.000").notNull(),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
    vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("0.00").notNull(),
    netAmount: decimal("netAmount", { precision: 12, scale: 2 }).notNull(),
    vatAmount: decimal("vatAmount", { precision: 12, scale: 2 }).notNull(),
    grossAmount: decimal("grossAmount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("invoice_lines_invoice_idx").on(table.invoiceId)],
);

export const payments = mysqlTable(
  "payments",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    invoiceId: int("invoiceId").notNull().references(() => invoices.id),
    receivedAt: bigint("receivedAt", { mode: "number" }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    reference: varchar("reference", { length: 160 }),
    notes: text("notes"),
    recordedBy: int("recordedBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("payments_invoice_idx").on(table.invoiceId, table.receivedAt)],
);

export const creditNotes = mysqlTable(
  "creditNotes",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    invoiceId: int("invoiceId").notNull().references(() => invoices.id),
    creditNumber: varchar("creditNumber", { length: 64 }).notNull(),
    creditDate: bigint("creditDate", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    netAmount: decimal("netAmount", { precision: 12, scale: 2 }).notNull(),
    vatAmount: decimal("vatAmount", { precision: 12, scale: 2 }).notNull(),
    total: decimal("total", { precision: 12, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["draft", "issued", "void"]).default("draft").notNull(),
    issuedAt: bigint("issuedAt", { mode: "number" }),
    issuedBy: int("issuedBy").references(() => users.id),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("credit_number_uq").on(table.entityId, table.creditNumber), index("credit_invoice_idx").on(table.invoiceId)],
);

export const invoiceEvents = mysqlTable(
  "invoiceEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    invoiceId: int("invoiceId").notNull().references(() => invoices.id),
    eventType: mysqlEnum("eventType", ["created", "approved", "issued", "delivered", "reminded", "disputed", "dispute_resolved", "payment", "credit", "reconciled", "voided", "document_generated", "secure_link_created", "secure_link_viewed", "secure_link_revoked"]).notNull(),
    occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
    actorUserId: int("actorUserId").references(() => users.id),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("invoice_event_idx").on(table.invoiceId, table.occurredAt)],
);

export const providerPacks = mysqlTable(
  "providerPacks",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").references(() => properties.id),
    localAuthorityId: int("localAuthorityId").references(() => localAuthorities.id),
    title: varchar("title", { length: 240 }).notNull(),
    status: mysqlEnum("status", ["draft", "ready", "shared", "expired", "archived"]).default("draft").notNull(),
    includeBankDetails: int("includeBankDetails").default(0).notNull(),
    snapshot: json("snapshot").$type<Record<string, unknown>>(),
    documentId: int("documentId").references(() => documents.id),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("provider_pack_entity_status_idx").on(table.entityId, table.status)],
);

export const secureLinks = mysqlTable(
  "secureLinks",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    providerPackId: int("providerPackId").references(() => providerPacks.id),
    documentId: int("documentId").references(() => documents.id),
    invoiceId: int("invoiceId").references(() => invoices.id),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
    recipientEmail: varchar("recipientEmail", { length: 320 }),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
    maxViews: int("maxViews"),
    viewCount: int("viewCount").default(0).notNull(),
    revokedAt: bigint("revokedAt", { mode: "number" }),
    lastViewedAt: bigint("lastViewedAt", { mode: "number" }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("secure_link_token_uq").on(table.tokenHash), index("secure_link_expiry_idx").on(table.expiresAt)],
);

export const guestInvitations = mysqlTable(
  "guestInvitations",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    purpose: mysqlEnum("purpose", ["property_summary"]).default("property_summary").notNull(),
    recipientLabel: varchar("recipientLabel", { length: 180 }),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
    maxUses: int("maxUses").default(1).notNull(),
    useCount: int("useCount").default(0).notNull(),
    revokedAt: bigint("revokedAt", { mode: "number" }),
    lastAccessedAt: bigint("lastAccessedAt", { mode: "number" }),
    createdBy: int("createdBy").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("guest_invitation_token_uq").on(table.tokenHash),
    index("guest_invitation_entity_idx").on(table.entityId, table.createdAt),
    index("guest_invitation_expiry_idx").on(table.expiresAt),
  ],
);

export const colleagueInvitations = mysqlTable(
  "colleagueInvitations",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").notNull().references(() => entities.id),
    email: varchar("email", { length: 320 }).notNull(),
    emailNormalized: varchar("emailNormalized", { length: 320 }).notNull(),
    operationalRole: mysqlEnum("operationalRole", ["owner", "registered_manager", "support_worker", "hr_compliance", "finance", "read_only"]).notNull(),
    allProperties: int("allProperties").default(0).notNull(),
    extraCapabilities: json("extraCapabilities").$type<string[]>(),
    status: mysqlEnum("status", ["pending", "accepted", "revoked", "expired"]).default("pending").notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
    acceptedAt: bigint("acceptedAt", { mode: "number" }),
    acceptedByUserId: int("acceptedByUserId").references(() => users.id),
    revokedAt: bigint("revokedAt", { mode: "number" }),
    createdBy: int("createdBy").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("colleague_invitation_entity_status_idx").on(table.entityId, table.status, table.expiresAt),
    index("colleague_invitation_email_idx").on(table.emailNormalized, table.status),
  ],
);

export const colleagueInvitationPropertyGrants = mysqlTable(
  "colleagueInvitationPropertyGrants",
  {
    id: int("id").autoincrement().primaryKey(),
    invitationId: int("invitationId").notNull().references(() => colleagueInvitations.id),
    propertyId: int("propertyId").notNull().references(() => properties.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("colleague_invitation_property_uq").on(table.invitationId, table.propertyId),
    index("colleague_invitation_property_idx").on(table.propertyId),
  ],
);

export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").references(() => entities.id),
    userId: int("userId").notNull().references(() => users.id),
    type: varchar("type", { length: 100 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    message: text("message").notNull(),
    severity: mysqlEnum("severity", ["info", "warning", "urgent"]).default("info").notNull(),
    resourceType: varchar("resourceType", { length: 80 }),
    resourceId: int("resourceId"),
    deepLink: varchar("deepLink", { length: 400 }),
    dueAt: bigint("dueAt", { mode: "number" }),
    readAt: bigint("readAt", { mode: "number" }),
    resolvedAt: bigint("resolvedAt", { mode: "number" }),
    acknowledgementRequired: int("acknowledgementRequired").default(1).notNull(),
    snoozedUntil: bigint("snoozedUntil", { mode: "number" }),
    escalationDueAt: bigint("escalationDueAt", { mode: "number" }),
    escalationState: mysqlEnum("escalationState", ["none", "escalated", "acknowledged", "resolved"]).default("none").notNull(),
    escalationCount: int("escalationCount").default(0).notNull(),
    dedupeKey: varchar("dedupeKey", { length: 240 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("notification_dedupe_uq").on(table.userId, table.dedupeKey), index("notification_user_idx").on(table.userId, table.readAt)],
);

export const auditLogs = mysqlTable(
  "auditLogs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
    actorUserId: int("actorUserId").references(() => users.id),
    actorType: mysqlEnum("actorType", ["user", "scheduled_job", "system", "secure_link"]).default("user").notNull(),
    entityId: int("entityId").references(() => entities.id),
    propertyId: int("propertyId").references(() => properties.id),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resourceType", { length: 80 }).notNull(),
    resourceId: varchar("resourceId", { length: 80 }),
    sensitivity: mysqlEnum("sensitivity", ["general", "hr", "finance", "safeguarding", "bank", "restricted"])
      .default("general")
      .notNull(),
    result: mysqlEnum("result", ["allowed", "denied", "success", "failure"]).notNull(),
    reasonCode: varchar("reasonCode", { length: 120 }),
    correlationId: varchar("correlationId", { length: 80 }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    previousHash: varchar("previousHash", { length: 128 }),
    eventHash: varchar("eventHash", { length: 128 }),
  },
  table => [
    index("audit_resource_idx").on(table.resourceType, table.resourceId, table.occurredAt),
    index("audit_actor_idx").on(table.actorUserId, table.occurredAt),
  ],
);

export const savedViews = mysqlTable(
  "savedViews",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    entityId: int("entityId").references(() => entities.id),
    name: varchar("name", { length: 140 }).notNull(),
    viewType: varchar("viewType", { length: 80 }).notNull(),
    filters: json("filters").$type<Record<string, unknown>>().notNull(),
    isDefault: int("isDefault").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("saved_view_name_uq").on(table.userId, table.viewType, table.name)],
);

export const recordShortcuts = mysqlTable(
  "recordShortcuts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id),
    entityId: int("entityId").notNull().references(() => entities.id),
    resourceType: varchar("resourceType", { length: 80 }).notNull(),
    resourceId: varchar("resourceId", { length: 80 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    isFavorite: int("isFavorite").default(0).notNull(),
    lastViewedAt: bigint("lastViewedAt", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("record_shortcut_uq").on(table.userId, table.entityId, table.resourceType, table.resourceId), index("record_shortcut_recent_idx").on(table.userId, table.entityId, table.lastViewedAt)],
);

export const automationRules = mysqlTable(
  "automationRules",
  {
    id: int("id").autoincrement().primaryKey(),
    entityId: int("entityId").references(() => entities.id),
    name: varchar("name", { length: 180 }).notNull(),
    ruleType: mysqlEnum("ruleType", ["compliance", "review", "work_plan", "policy", "placement", "invoice"]).notNull(),
    configuration: json("configuration").$type<Record<string, unknown>>().notNull(),
    scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
    enabled: int("enabled").default(1).notNull(),
    lastRunAt: bigint("lastRunAt", { mode: "number" }),
    createdBy: int("createdBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("automation_task_uid_idx").on(table.scheduleCronTaskUid)],
);


export const allegationEvidence = mysqlTable("allegationEvidence", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	allegationId: int().notNull().references(() => allegations.id),
	documentId: int().notNull().references(() => documents.id),
	evidenceType: mysqlEnum(['chronology','statement','correspondence','agency_decision','meeting_record','outcome','other']).notNull(),
	description: varchar({ length: 500 }),
	addedBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	uniqueIndex("allegation_evidence_uq").on(table.allegationId, table.documentId),
]);

export const allegations = mysqlTable("allegations", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	propertyId: int().references(() => properties.id),
	placementId: int().references(() => placements.id),
	incidentId: int().references(() => incidents.id),
	personConcernType: mysqlEnum(['staff','agency','volunteer','professional','other']).notNull(),
	staffProfileId: int().references(() => staffProfiles.id),
	personConcernCiphertext: text(),
	allegationType: mysqlEnum(['harm','possible_offence','suitability','position_of_trust','policy_breach','other']).notNull(),
	neutralSummaryCiphertext: text().notNull(),
	immediateProtectionCiphertext: text().notNull(),
	ladoDecision: mysqlEnum(['not_contacted','pending','strategy_discussion','employer_action','police_investigation','no_further_action','other']).default('pending').notNull(),
	ladoReference: varchar({ length: 120 }),
	policeDecision: mysqlEnum(['not_contacted','pending','investigating','no_further_action','charged','other']).default('not_contacted').notNull(),
	policeReference: varchar({ length: 120 }),
	ofstedDecision: mysqlEnum(['unreviewed','not_notifiable','notify','submitted']).default('unreviewed').notNull(),
	outcome: mysqlEnum(['pending','substantiated','unsubstantiated','unfounded','malicious','false','no_further_action','other']).default('pending').notNull(),
	outcomeCiphertext: text(),
	status: mysqlEnum(['open','referred','investigating','employer_action','closed']).default('open').notNull(),
	restrictedOwnerUserId: int().references(() => users.id),
	reviewDueAt: bigint({ mode: "number" }),
	closedAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("allegation_due_idx").on(table.entityId, table.reviewDueAt, table.status),
]);

export const analyticsMeasures = mysqlTable("analyticsMeasures", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	key: varchar({ length: 100 }).notNull(),
	name: varchar({ length: 220 }).notNull(),
	domain: mysqlEnum(['incident','complaint','missing','restraint','placement','staffing','compliance','finance','improvement','outcome','feedback']).notNull(),
	measureType: mysqlEnum(['count','percentage','average','duration','currency','score','custom']).notNull(),
	unit: varchar({ length: 60 }),
	direction: mysqlEnum(['higher_is_better','lower_is_better','neutral']).default('neutral').notNull(),
	sourceType: mysqlEnum(['system','manual_observation','young_person_feedback']).default('system').notNull(),
	numeratorDefinition: text(),
	denominatorDefinition: text(),
	exclusionNotes: text(),
	configuration: json(),
	status: mysqlEnum(['draft','active','paused','archived']).default('draft').notNull(),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("analytics_measure_key_uq").on(table.entityId, table.key),
	index("analytics_measure_domain_idx").on(table.entityId, table.domain, table.status),
]);

export const assuranceSchedules = mysqlTable("assuranceSchedules", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().references(() => entities.id),
	name: varchar({ length: 180 }).notNull(),
	jobType: mysqlEnum(['scan_retry','audit_verify','resilience_due','access_review_due']).notNull(),
	configuration: json().notNull(),
	scheduleCronTaskUid: varchar({ length: 65 }),
	enabled: int().default(1).notNull(),
	lastRunAt: bigint({ mode: "number" }),
	lastResult: json(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("assurance_schedule_task_uid_idx").on(table.scheduleCronTaskUid),
]);

export const auditReceiptMirrors = mysqlTable("auditReceiptMirrors", {
	id: int("id").autoincrement().primaryKey(),
	auditEventId: bigint({ mode: "number" }).notNull().references(() => auditLogs.id),
	entityId: int().references(() => entities.id),
	storageKey: varchar({ length: 700 }).notNull(),
	eventHash: varchar({ length: 128 }).notNull(),
	status: mysqlEnum(['stored','verified','missing','mismatch']).default('stored').notNull(),
	lastVerifiedAt: bigint({ mode: "number" }),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	uniqueIndex("audit_receipt_event_uq").on(table.auditEventId),
	index("audit_receipt_verify_idx").on(table.entityId, table.status, table.lastVerifiedAt),
]);

export const auditVerificationRuns = mysqlTable("auditVerificationRuns", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().references(() => entities.id),
	rangeStartId: bigint({ mode: "number" }),
	rangeEndId: bigint({ mode: "number" }),
	checkedEvents: int().default(0).notNull(),
	chainMismatches: int().default(0).notNull(),
	missingReceipts: int().default(0).notNull(),
	status: mysqlEnum(['running','passed','warning','failed']).default('running').notNull(),
	summary: text(),
	manifest: json(),
	startedAt: bigint({ mode: "number" }).notNull(),
	completedAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("audit_verification_idx").on(table.entityId, table.startedAt, table.status),
]);

export const behaviourSupportEvents = mysqlTable("behaviourSupportEvents", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	propertyId: int().notNull().references(() => properties.id),
	placementId: int().notNull().references(() => placements.id),
	incidentId: int().references(() => incidents.id),
	supportPlanId: int().references(() => carePlans.id),
	occurredAt: bigint({ mode: "number" }).notNull(),
	antecedentCiphertext: text().notNull(),
	behaviourCiphertext: text().notNull(),
	consequenceCiphertext: text().notNull(),
	positiveSupportCiphertext: text().notNull(),
	effectiveness: mysqlEnum(['effective','partly_effective','not_effective','unclear']).notNull(),
	youngPersonFeedbackCiphertext: text(),
	reviewRequired: int().default(0).notNull(),
	reviewDueAt: bigint({ mode: "number" }),
	reviewedAt: bigint({ mode: "number" }),
	reviewedBy: int().references(() => users.id),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("behaviour_review_idx").on(table.entityId, table.reviewRequired, table.reviewDueAt),
]);

export const complaintEscalations = mysqlTable("complaintEscalations", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	complaintId: int().notNull().references(() => complaints.id),
	fromUserId: int().references(() => users.id),
	toUserId: int().references(() => users.id),
	targetType: mysqlEnum(['owner','registered_manager','responsible_individual','local_authority','ofsted','ombudsman','other']).notNull(),
	targetName: varchar({ length: 220 }),
	reasonCiphertext: text().notNull(),
	dueAt: bigint({ mode: "number" }),
	status: mysqlEnum(['sent','acknowledged','resolved','cancelled']).default('sent').notNull(),
	acknowledgedAt: bigint({ mode: "number" }),
	acknowledgedBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("complaint_escalation_idx").on(table.complaintId, table.status, table.createdAt),
]);

export const complaints = mysqlTable("complaints", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	propertyId: int().references(() => properties.id),
	placementId: int().references(() => placements.id),
	incidentId: int().references(() => incidents.id),
	complainantType: mysqlEnum(['young_person','family_advocate','professional','staff','neighbour','anonymous','other']).notNull(),
	complainantCiphertext: text(),
	consentState: mysqlEnum(['given','not_given','not_required','unable','unknown']).default('unknown').notNull(),
	accessibilityNeedsCiphertext: text(),
	stage: mysqlEnum(['informal','stage_1','stage_2','external','closed']).default('stage_1').notNull(),
	category: mysqlEnum(['quality','staff_conduct','safeguarding','property','privacy','finance','discrimination','other']).notNull(),
	summaryCiphertext: text().notNull(),
	receivedAt: bigint({ mode: "number" }).notNull(),
	responseDueAt: bigint({ mode: "number" }).notNull(),
	acknowledgedAt: bigint({ mode: "number" }),
	outcome: mysqlEnum(['upheld','partially_upheld','not_upheld','withdrawn','unresolved','pending']).default('pending').notNull(),
	responseCiphertext: text(),
	learningCiphertext: text(),
	escalationTarget: varchar({ length: 220 }),
	status: mysqlEnum(['received','acknowledged','investigating','response_due','escalated','closed']).default('received').notNull(),
	ownerUserId: int().references(() => users.id),
	closedAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("complaint_due_idx").on(table.entityId, table.responseDueAt, table.status),
]);

export const curfewChecks = mysqlTable("curfewChecks", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	curfewPlanId: int().notNull().references(() => curfewPlans.id),
	expectedAt: bigint({ mode: "number" }).notNull(),
	actualAt: bigint({ mode: "number" }),
	status: mysqlEnum(['met','late','absent','authorised_away','not_applicable','pending']).default('pending').notNull(),
	contactAttemptsCiphertext: text(),
	reasonCiphertext: text(),
	escalationRequired: int().default(0).notNull(),
	actionTakenCiphertext: text(),
	acknowledgedBy: int().references(() => users.id),
	acknowledgedAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("curfew_check_due_idx").on(table.placementId, table.expectedAt, table.status),
]);

export const curfewPlans = mysqlTable("curfewPlans", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	weekdays: json().notNull(),
	expectedLeaveTime: varchar({ length: 8 }),
	expectedReturnTime: varchar({ length: 8 }).notNull(),
	graceMinutes: int().default(15).notNull(),
	instructionsCiphertext: text(),
	escalationAfterMinutes: int().default(30).notNull(),
	startsAt: bigint({ mode: "number" }).notNull(),
	endsAt: bigint({ mode: "number" }),
	reviewDueAt: bigint({ mode: "number" }),
	status: mysqlEnum(['draft','active','paused','ended']).default('draft').notNull(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("curfew_plan_placement_idx").on(table.placementId, table.status, table.reviewDueAt),
]);

export const dataRightsCases = mysqlTable("dataRightsCases", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().references(() => placements.id),
	caseReference: varchar({ length: 64 }).notNull(),
	requestType: mysqlEnum(['access','rectification','restriction','objection','erasure','portability','sharing_review','complaint']).notNull(),
	requesterType: mysqlEnum(['young_person','parent','representative','professional','staff','other']).notNull(),
	requesterNameCiphertext: text().notNull(),
	requesterContactCiphertext: text(),
	representativeNameCiphertext: text(),
	representativeAuthority: text(),
	communicationNeedsCiphertext: text(),
	identityStatus: mysqlEnum(['not_started','pending','verified','failed','not_required']).default('not_started').notNull(),
	identityMethod: varchar({ length: 160 }),
	identityEvidenceDocumentId: int().references(() => documents.id),
	scope: json().notNull(),
	receivedAt: bigint({ mode: "number" }).notNull(),
	dueAt: bigint({ mode: "number" }).notNull(),
	extensionUntil: bigint({ mode: "number" }),
	extensionReason: text(),
	exemptionBasis: text(),
	status: mysqlEnum(['received','identity_check','scoping','collecting','redacting','awaiting_approval','ready','delivered','restricted','refused','withdrawn','closed','overdue']).default('received').notNull(),
	ownerUserId: int().references(() => users.id),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	exportJobId: int().references(() => exportJobs.id),
	deliveryDocumentId: int().references(() => documents.id),
	deliveredAt: bigint({ mode: "number" }),
	closedAt: bigint({ mode: "number" }),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
	identityReferenceCiphertext: text(),
	identityVerifiedBy: int().references(() => users.id),
	identityVerifiedAt: bigint({ mode: "number" }),
	identityFailureReason: text(),
},
(table) => [
	uniqueIndex("data_rights_case_ref_uq").on(table.entityId, table.caseReference),
	index("data_rights_due_idx").on(table.entityId, table.status, table.dueAt),
]);

export const dataRightsEvents = mysqlTable("dataRightsEvents", {
	id: bigint({ mode: "number" }).autoincrement().notNull(),
	entityId: int().notNull().references(() => entities.id),
	caseId: int().notNull().references(() => dataRightsCases.id),
	eventType: varchar({ length: 100 }).notNull(),
	occurredAt: bigint({ mode: "number" }).notNull(),
	actorUserId: int().references(() => users.id),
	metadata: json(),
},
(table) => [
	index("data_rights_event_idx").on(table.caseId, table.occurredAt),
]);

export const documentScanJobs = mysqlTable("documentScanJobs", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	documentId: int().notNull().references(() => documents.id),
	documentVersionId: int().notNull().references(() => documentVersions.id),
	providerType: mysqlEnum(['built_in','webhook','manual_review']).default('manual_review').notNull(),
	providerName: varchar({ length: 160 }),
	providerReference: varchar({ length: 220 }),
	status: mysqlEnum(['queued','submitted','clean','quarantined','failed','overridden','cancelled']).default('queued').notNull(),
	verdict: varchar({ length: 160 }),
	threatName: varchar({ length: 220 }),
	attempts: int().default(0).notNull(),
	lastAttemptAt: bigint({ mode: "number" }),
	nextRetryAt: bigint({ mode: "number" }),
	completedAt: bigint({ mode: "number" }),
	overrideReason: text(),
	overriddenBy: int().references(() => users.id),
	metadata: json(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("scan_job_retry_idx").on(table.status, table.nextRetryAt),
	index("scan_job_document_idx").on(table.documentVersionId, table.createdAt),
]);

export const eSignatureEnvelopes = mysqlTable("eSignatureEnvelopes", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	connectionId: int().references(() => integrationConnections.id),
	documentId: int().notNull().references(() => documents.id),
	documentVersionId: int().notNull().references(() => documentVersions.id),
	title: varchar({ length: 240 }).notNull(),
	status: mysqlEnum(['draft','pending_approval','sent','viewed','part_signed','completed','declined','expired','voided','failed']).default('draft').notNull(),
	providerReference: varchar({ length: 200 }),
	expiresAt: bigint({ mode: "number" }),
	sentAt: bigint({ mode: "number" }),
	completedAt: bigint({ mode: "number" }),
	completionEvidenceDocumentId: int().references(() => documents.id),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("esign_envelope_entity_status_idx").on(table.entityId, table.status),
]);

export const eSignatureSigners = mysqlTable("eSignatureSigners", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	envelopeId: int().notNull().references(() => eSignatureEnvelopes.id),
	signerRole: varchar({ length: 120 }).notNull(),
	nameCiphertext: text().notNull(),
	emailCiphertext: text().notNull(),
	signingOrder: int().default(1).notNull(),
	status: mysqlEnum(['pending','sent','viewed','signed','declined','expired']).default('pending').notNull(),
	viewedAt: bigint({ mode: "number" }),
	signedAt: bigint({ mode: "number" }),
	providerReference: varchar({ length: 200 }),
},
(table) => [
	index("esign_signer_envelope_idx").on(table.envelopeId, table.signingOrder, table.status),
]);

export const evidenceFrameworks = mysqlTable("evidenceFrameworks", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().references(() => entities.id),
	regimeId: int().notNull().references(() => regulatoryRegimes.id),
	name: varchar({ length: 220 }).notNull(),
	description: text(),
	version: int().default(1).notNull(),
	status: mysqlEnum(['draft','in_review','approved','active','superseded','rolled_back']).default('draft').notNull(),
	effectiveFrom: bigint({ mode: "number" }),
	effectiveTo: bigint({ mode: "number" }),
	previousFrameworkId: int(),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	activatedBy: int().references(() => users.id),
	activatedAt: bigint({ mode: "number" }),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("framework_regime_status_idx").on(table.regimeId, table.status, table.version),
]);

export const frameworkPublications = mysqlTable("frameworkPublications", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().references(() => entities.id),
	frameworkId: int().notNull().references(() => evidenceFrameworks.id),
	publicationType: mysqlEnum(['validation','impact_preview','approval','activation','rollback']).notNull(),
	status: mysqlEnum(['pending','passed','failed','approved','completed','rolled_back']).default('pending').notNull(),
	validationErrors: json(),
	validationWarnings: json(),
	impactSnapshot: json(),
	obligationCount: int().default(0).notNull(),
	affectedRecordCount: int().default(0).notNull(),
	previousFrameworkId: int(),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	completedAt: bigint({ mode: "number" }),
	notes: text(),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("framework_publication_idx").on(table.frameworkId, table.publicationType, table.createdAt),
]);

export const frameworkRequirements = mysqlTable("frameworkRequirements", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().references(() => entities.id),
	frameworkId: int().notNull().references(() => evidenceFrameworks.id),
	parentRequirementId: int(),
	code: varchar({ length: 100 }).notNull(),
	title: varchar({ length: 240 }).notNull(),
	description: text(),
	outcomeArea: varchar({ length: 180 }).notNull(),
	standardName: varchar({ length: 220 }),
	category: mysqlEnum(['property','workforce','placement','policy','quality','finance','data_protection']).notNull(),
	applicability: json().notNull(),
	recurrence: mysqlEnum(['once','monthly','quarterly','six_monthly','annual','event_driven','custom']).default('annual').notNull(),
	customIntervalDays: int(),
	leadDays: int().default(30).notNull(),
	ownerRole: varchar({ length: 80 }).notNull(),
	evidenceRules: json().notNull(),
	escalationRules: json().notNull(),
	mappings: json(),
	required: int().default(1).notNull(),
	status: mysqlEnum(['draft','active','retired']).default('draft').notNull(),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("framework_requirement_code_uq").on(table.frameworkId, table.code),
	index("framework_requirement_status_idx").on(table.frameworkId, table.status, table.category),
]);

export const healthMonitoringEvents = mysqlTable("healthMonitoringEvents", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	planId: int().notNull().references(() => healthMonitoringPlans.id),
	occurredAt: bigint({ mode: "number" }).notNull(),
	value: varchar({ length: 180 }),
	unit: varchar({ length: 80 }),
	outcome: mysqlEnum(['within_expected','outside_expected','unable','declined','not_required','other']).notNull(),
	notesCiphertext: text(),
	escalationRequired: int().default(0).notNull(),
	escalationActionCiphertext: text(),
	acknowledgedBy: int().references(() => users.id),
	acknowledgedAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("health_event_placement_idx").on(table.placementId, table.occurredAt, table.outcome),
]);

export const healthMonitoringPlans = mysqlTable("healthMonitoringPlans", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	monitoringType: mysqlEnum(['blood_pressure','blood_glucose','weight','temperature','seizure','sleep','nutrition','hydration','mental_wellbeing','pain','wound','other']).notNull(),
	title: varchar({ length: 220 }).notNull(),
	frequency: mysqlEnum(['as_required','once_daily','twice_daily','weekly','monthly','event_based','other']).notNull(),
	instructionsCiphertext: text().notNull(),
	expectedRange: varchar({ length: 180 }),
	escalationThreshold: varchar({ length: 220 }),
	escalationActionCiphertext: text(),
	responsibleRole: mysqlEnum(['key_worker','support_worker','manager','health_professional','other']).default('key_worker').notNull(),
	consentBasis: mysqlEnum(['young_person_consent','care_plan','clinical_instruction','best_interests','other']).notNull(),
	startsAt: bigint({ mode: "number" }).notNull(),
	endsAt: bigint({ mode: "number" }),
	nextDueAt: bigint({ mode: "number" }),
	reviewDueAt: bigint({ mode: "number" }).notNull(),
	status: mysqlEnum(['draft','active','paused','ended']).default('draft').notNull(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("health_plan_due_idx").on(table.entityId, table.placementId, table.status, table.nextDueAt),
]);

export const identityAssuranceReviews = mysqlTable("identityAssuranceReviews", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	userId: int().references(() => users.id),
	assuranceType: mysqlEnum(['mfa','sso','account_recovery','role_sign_off','access_review','break_glass','joiner_mover_leaver']).notNull(),
	provider: varchar({ length: 160 }),
	assuranceMethod: varchar({ length: 220 }),
	status: mysqlEnum(['planned','in_review','passed','conditional','failed','revoked','expired']).default('planned').notNull(),
	reviewedAt: bigint({ mode: "number" }),
	nextReviewAt: bigint({ mode: "number" }),
	evidenceDocumentId: int().references(() => documents.id),
	riskNotes: text(),
	decisionNotes: text(),
	reviewedBy: int().references(() => users.id),
	approvedBy: int().references(() => users.id),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("identity_assurance_due_idx").on(table.entityId, table.nextReviewAt, table.status),
	index("identity_assurance_user_idx").on(table.userId, table.assuranceType),
]);

export const incidentChronology = mysqlTable("incidentChronology", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	incidentId: int().notNull().references(() => incidents.id),
	occurredAt: bigint({ mode: "number" }).notNull(),
	eventType: mysqlEnum(['observation','disclosure','action','contact','decision','notification','outcome','other']).notNull(),
	neutralAccountCiphertext: text().notNull(),
	source: mysqlEnum(['direct_observation','young_person','staff','professional','witness','record','other']).notNull(),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("incident_chronology_idx").on(table.incidentId, table.occurredAt),
]);

export const incidentWitnesses = mysqlTable("incidentWitnesses", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	incidentId: int().notNull().references(() => incidents.id),
	witnessType: mysqlEnum(['young_person','staff','professional','public','other']).notNull(),
	witnessUserId: int().references(() => users.id),
	nameCiphertext: text(),
	contactCiphertext: text(),
	statementDocumentId: int().references(() => documents.id),
	consentToContact: int().default(0).notNull(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("incident_witness_idx").on(table.incidentId, table.witnessType),
]);

export const integrationAttempts = mysqlTable("integrationAttempts", {
	id: bigint({ mode: "number" }).autoincrement().notNull(),
	entityId: int().notNull().references(() => entities.id),
	deliveryId: int().notNull().references(() => integrationDeliveries.id),
	attemptNumber: int().notNull(),
	startedAt: bigint({ mode: "number" }).notNull(),
	completedAt: bigint({ mode: "number" }),
	outcome: mysqlEnum(['processing','delivered','acknowledged','retry','failed','duplicate']).default('processing').notNull(),
	httpStatus: int(),
	providerReference: varchar({ length: 200 }),
	responseHash: varchar({ length: 128 }),
	errorCode: varchar({ length: 120 }),
	errorMessage: text(),
	retryAt: bigint({ mode: "number" }),
	metadata: json(),
},
(table) => [
	uniqueIndex("integration_attempt_number_uq").on(table.deliveryId, table.attemptNumber),
	index("integration_attempt_delivery_idx").on(table.deliveryId, table.startedAt),
]);

export const integrationConnections = mysqlTable("integrationConnections", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	name: varchar({ length: 180 }).notNull(),
	integrationType: mysqlEnum(['payroll','accounting','esignature','email','sms','local_authority','monitoring','malware_scan','generic_webhook']).notNull(),
	adapterType: mysqlEnum(['secure_export','signed_webhook','rest_api','smtp_api','sms_api','esign_api','scan_api']).notNull(),
	direction: mysqlEnum(['outbound','inbound','bidirectional']).default('outbound').notNull(),
	status: mysqlEnum(['draft','pending_approval','active','paused','failed','revoked']).default('draft').notNull(),
	endpointUrl: text(),
	secretCiphertext: text(),
	credentialLabel: varchar({ length: 160 }),
	scopes: json().notNull(),
	config: json(),
	allowedResourceTypes: json(),
	rateLimitPerMinute: int().default(30).notNull(),
	maxAttempts: int().default(5).notNull(),
	retryBaseMinutes: int().default(5).notNull(),
	healthStatus: mysqlEnum(['not_checked','healthy','degraded','failed']).default('not_checked').notNull(),
	lastHealthCheckAt: bigint({ mode: "number" }),
	lastSuccessAt: bigint({ mode: "number" }),
	lastFailureAt: bigint({ mode: "number" }),
	lastError: text(),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	scheduleCronTaskUid: varchar({ length: 65 }),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("integration_entity_status_idx").on(table.entityId, table.status, table.integrationType),
	index("integration_task_uid_idx").on(table.scheduleCronTaskUid),
]);

export const integrationDeliveries = mysqlTable("integrationDeliveries", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	connectionId: int().notNull().references(() => integrationConnections.id),
	deliveryType: mysqlEnum(['payroll_export','invoice_export','credit_export','payment_import','reconciliation_import','esign_envelope','email','sms','referral_exchange','placement_exchange','invoice_exchange','evidence_pack','status_exchange','health_check','scan_request','generic']).notNull(),
	resourceType: varchar({ length: 80 }),
	resourceId: varchar({ length: 80 }),
	idempotencyKey: varchar({ length: 180 }).notNull(),
	payloadSnapshot: json().notNull(),
	payloadHash: varchar({ length: 128 }).notNull(),
	status: mysqlEnum(['draft','pending_approval','queued','processing','delivered','acknowledged','retry_scheduled','failed','cancelled','duplicate']).default('draft').notNull(),
	humanApprovedBy: int().references(() => users.id),
	humanApprovedAt: bigint({ mode: "number" }),
	recipientSnapshot: json(),
	scheduledFor: bigint({ mode: "number" }),
	attemptCount: int().default(0).notNull(),
	nextAttemptAt: bigint({ mode: "number" }),
	providerReference: varchar({ length: 200 }),
	deliveredAt: bigint({ mode: "number" }),
	acknowledgedAt: bigint({ mode: "number" }),
	lastError: text(),
	exportDocumentId: int().references(() => documents.id),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("integration_delivery_dedupe_uq").on(table.connectionId, table.idempotencyKey),
	index("integration_delivery_queue_idx").on(table.connectionId, table.status, table.nextAttemptAt),
]);

export const integrationReceipts = mysqlTable("integrationReceipts", {
	id: bigint({ mode: "number" }).autoincrement().notNull(),
	entityId: int().notNull().references(() => entities.id),
	connectionId: int().notNull().references(() => integrationConnections.id),
	externalEventId: varchar({ length: 220 }).notNull(),
	eventType: varchar({ length: 120 }).notNull(),
	signatureValid: int().default(0).notNull(),
	receivedAt: bigint({ mode: "number" }).notNull(),
	payloadHash: varchar({ length: 128 }).notNull(),
	status: mysqlEnum(['received','duplicate','processed','rejected','failed']).default('received').notNull(),
	processedAt: bigint({ mode: "number" }),
	linkedResourceType: varchar({ length: 80 }),
	linkedResourceId: varchar({ length: 80 }),
	errorMessage: text(),
	payloadSnapshot: json(),
	reviewedBy: int().references(() => users.id),
	reviewedAt: bigint({ mode: "number" }),
},
(table) => [
	uniqueIndex("integration_receipt_event_uq").on(table.connectionId, table.externalEventId),
	index("integration_receipt_status_idx").on(table.connectionId, table.status, table.receivedAt),
]);

export const medicationAdministrations = mysqlTable("medicationAdministrations", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	medicationId: int().notNull().references(() => medications.id),
	scheduledAt: bigint({ mode: "number" }).notNull(),
	administeredAt: bigint({ mode: "number" }),
	outcome: mysqlEnum(['taken','refused','omitted','unavailable','asleep','away','other']).notNull(),
	doseAcknowledged: varchar({ length: 120 }),
	reasonCiphertext: text(),
	actionTakenCiphertext: text(),
	witnessUserId: int().references(() => users.id),
	escalationRequired: int().default(0).notNull(),
	managerAcknowledgedBy: int().references(() => users.id),
	managerAcknowledgedAt: bigint({ mode: "number" }),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("med_admin_due_idx").on(table.placementId, table.scheduledAt, table.outcome),
]);

export const medications = mysqlTable("medications", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	name: varchar({ length: 220 }).notNull(),
	form: mysqlEnum(['tablet','capsule','liquid','inhaler','cream','injection','patch','drops','other']).notNull(),
	dose: varchar({ length: 120 }).notNull(),
	route: mysqlEnum(['oral','inhaled','topical','subcutaneous','intramuscular','eye','ear','nasal','other']).notNull(),
	frequency: mysqlEnum(['once_daily','twice_daily','three_times_daily','four_times_daily','weekly','as_required','other']).notNull(),
	administrationWindow: varchar({ length: 180 }).notNull(),
	instructionsCiphertext: text(),
	prnInstructionsCiphertext: text(),
	supportModel: mysqlEnum(['staff_administered','supported_self_administration','self_administration']).default('staff_administered').notNull(),
	selfAdministrationAssessmentCiphertext: text(),
	selfAdministrationReviewDueAt: bigint({ mode: "number" }),
	storageLocationCiphertext: text(),
	prescriber: varchar({ length: 220 }),
	pharmacy: varchar({ length: 220 }),
	stockNotesCiphertext: text(),
	startsAt: bigint({ mode: "number" }).notNull(),
	endsAt: bigint({ mode: "number" }),
	nextDueAt: bigint({ mode: "number" }),
	reviewDueAt: bigint({ mode: "number" }),
	status: mysqlEnum(['draft','active','paused','ended']).default('draft').notNull(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("medication_due_idx").on(table.entityId, table.placementId, table.status, table.nextDueAt),
]);

export const missingEpisodes = mysqlTable("missingEpisodes", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	propertyId: int().notNull().references(() => properties.id),
	placementId: int().notNull().references(() => placements.id),
	incidentId: int().references(() => incidents.id),
	missingAt: bigint({ mode: "number" }).notNull(),
	discoveredAt: bigint({ mode: "number" }).notNull(),
	policeContactedAt: bigint({ mode: "number" }),
	policeReference: varchar({ length: 120 }),
	riskLevel: mysqlEnum(['low','medium','high','critical']).notNull(),
	circumstancesCiphertext: text().notNull(),
	actionsCiphertext: text().notNull(),
	notifications: json(),
	returnedAt: bigint({ mode: "number" }),
	returnMethod: mysqlEnum(['self_return','police','staff','family','authority','found','other']),
	returnCircumstancesCiphertext: text(),
	returnInterviewDueAt: bigint({ mode: "number" }),
	returnInterviewAt: bigint({ mode: "number" }),
	returnInterviewOutcomeCiphertext: text(),
	patternFlags: json(),
	learningCiphertext: text(),
	status: mysqlEnum(['missing','located','returned','interview_due','follow_up','closed']).default('missing').notNull(),
	managerUserId: int().references(() => users.id),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
	returnRecordedBy: int().references(() => users.id),
	returnInterviewBy: int().references(() => users.id),
	returnInterviewOverrideReasonCiphertext: text(),
},
(table) => [
	index("missing_episode_status_idx").on(table.entityId, table.status, table.missingAt),
]);

export const offlineSyncReceipts = mysqlTable("offlineSyncReceipts", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	userId: int().notNull().references(() => users.id),
	idempotencyKey: varchar({ length: 100 }).notNull(),
	operation: mysqlEnum(['key_worker_report','incident','clock_event','handover','visitor_entry','curfew_check','missing_episode','medication_administration','property_check','maintenance_job','resident_finance_transaction','lone_worker_check_in']).notNull(),
	payloadHash: varchar({ length: 64 }).notNull(),
	clientCreatedAt: bigint({ mode: "number" }).notNull(),
	clientVersion: int().default(1).notNull(),
	status: mysqlEnum(['applied','conflict','rejected']).notNull(),
	resourceType: varchar({ length: 80 }),
	resourceId: int(),
	conflictCode: varchar({ length: 100 }),
	conflictMessage: text(),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	uniqueIndex("offline_sync_user_key_uq").on(table.userId, table.idempotencyKey),
	index("offline_sync_entity_status_idx").on(table.entityId, table.status, table.createdAt),
]);

export const outcomeObservations = mysqlTable("outcomeObservations", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	measureId: int().notNull().references(() => analyticsMeasures.id),
	placementId: int().notNull().references(() => placements.id),
	propertyId: int().references(() => properties.id),
	periodStart: bigint({ mode: "number" }).notNull(),
	periodEnd: bigint({ mode: "number" }).notNull(),
	numericValue: decimal({ precision: 12, scale: 3 }),
	feedbackScore: int(),
	feedbackCiphertext: text(),
	source: mysqlEnum(['young_person','key_worker','manager','professional','system_import']).notNull(),
	evidenceDocumentId: int().references(() => documents.id),
	contextNotes: text(),
	capturedBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("outcome_measure_period_idx").on(table.entityId, table.measureId, table.periodStart),
	index("outcome_placement_period_idx").on(table.placementId, table.periodStart),
]);

export const placementNotifications = mysqlTable("placementNotifications", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	propertyId: int().references(() => properties.id),
	notificationType: mysqlEnum(['admission','discharge']).notNull(),
	decision: mysqlEnum(['pending','notify_host_authority','same_authority_exempt','not_required']).default('pending').notNull(),
	decisionReason: text(),
	placingAuthorityId: int().references(() => localAuthorities.id),
	hostAuthorityId: int().references(() => localAuthorities.id),
	recipientName: varchar({ length: 220 }),
	recipientEmail: varchar({ length: 320 }),
	eventAt: bigint({ mode: "number" }).notNull(),
	dueAt: bigint({ mode: "number" }).notNull(),
	factsSnapshotCiphertext: text(),
	packDocumentId: int().references(() => documents.id),
	status: mysqlEnum(['draft','decision_recorded','pack_ready','submitted','exempt','overdue','closed']).default('draft').notNull(),
	submittedAt: bigint({ mode: "number" }),
	submittedBy: int().references(() => users.id),
	submissionMethod: mysqlEnum(['email','portal','secure_link','post','other']),
	submissionReference: varchar({ length: 180 }),
	submissionEvidenceDocumentId: int().references(() => documents.id),
	decisionBy: int().references(() => users.id),
	decisionAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
	dischargeDestinationType: mysqlEnum(['family','independent_living','supported_accommodation','semi_independent','custody','hospital','homeless','unknown','other']),
	dischargeReason: mysqlEnum(['planned_transition','placement_end','safeguarding','placement_breakdown','custody','hospital','young_person_choice','other']),
	dischargeDetailsCiphertext: text(),
	receivingAuthorityId: int().references(() => localAuthorities.id),
	handoverStatus: mysqlEnum(['not_started','planned','complete','not_applicable']),
	followUpRequired: int().default(0).notNull(),
	followUpDueAt: bigint({ mode: "number" }),
},
(table) => [
	uniqueIndex("placement_notification_type_uq").on(table.placementId, table.notificationType),
	index("placement_notification_due_idx").on(table.entityId, table.status, table.dueAt),
]);

export const processingRestrictions = mysqlTable("processingRestrictions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	caseId: int().references(() => dataRightsCases.id),
	placementId: int().references(() => placements.id),
	resourceType: varchar({ length: 80 }),
	resourceId: varchar({ length: 80 }),
	restrictionType: mysqlEnum(['all_processing','export','sharing','automation','correction','deletion','specified']).notNull(),
	reason: text().notNull(),
	blockedActions: json().notNull(),
	startsAt: bigint({ mode: "number" }).notNull(),
	endsAt: bigint({ mode: "number" }),
	status: mysqlEnum(['active','review_due','lifted','expired']).default('active').notNull(),
	approvedBy: int().references(() => users.id),
	liftedBy: int().references(() => users.id),
	liftedAt: bigint({ mode: "number" }),
	liftReason: text(),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("processing_restriction_scope_idx").on(table.entityId, table.placementId, table.status),
]);

export const professionalContacts = mysqlTable("professionalContacts", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	contactType: mysqlEnum(['social_worker','iro','personal_adviser','emergency_duty_team','health','education','probation','court','family_advocate','other']).notNull(),
	name: varchar({ length: 180 }).notNull(),
	roleTitle: varchar({ length: 180 }),
	organisation: varchar({ length: 220 }),
	phone: varchar({ length: 40 }),
	email: varchar({ length: 320 }),
	outOfHoursPhone: varchar({ length: 40 }),
	preferredContactMethod: mysqlEnum(['phone','email','secure_email','portal','other']).default('email').notNull(),
	isPrimary: int().default(0).notNull(),
	status: mysqlEnum(['active','inactive']).default('active').notNull(),
	notesCiphertext: text(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("professional_contact_placement_idx").on(table.placementId, table.contactType, table.status),
]);

export const qualityReviewConsultations = mysqlTable("qualityReviewConsultations", {
	id: int("id").autoincrement().primaryKey(),
	qualityReviewId: int().notNull().references(() => qualityReviews.id),
	entityId: int().notNull().references(() => entities.id),
	audience: mysqlEnum(['young_person','placing_authority','staff','professional','family_advocate','other']).notNull(),
	participantReference: varchar({ length: 180 }),
	invitedAt: bigint({ mode: "number" }),
	respondedAt: bigint({ mode: "number" }),
	method: mysqlEnum(['conversation','meeting','telephone','email','survey','written','advocate','other']),
	responseStatus: mysqlEnum(['planned','invited','responded','declined','no_response','not_applicable']).default('planned').notNull(),
	accessibilityNeeds: text(),
	responseSummary: text(),
	noResponseReason: text(),
	evidenceDocumentId: int().references(() => documents.id),
	recordedBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("quality_review_consultation_idx").on(table.qualityReviewId, table.audience, table.responseStatus),
]);

export const qualityReviewEvidence = mysqlTable("qualityReviewEvidence", {
	id: int("id").autoincrement().primaryKey(),
	qualityReviewId: int().notNull().references(() => qualityReviews.id),
	entityId: int().notNull().references(() => entities.id),
	category: mysqlEnum(['outcomes','safeguarding','staffing','placement_stability','complaints','incidents','compliance','feedback','education_health','independence','other']).notNull(),
	title: varchar({ length: 220 }).notNull(),
	sourceType: varchar({ length: 100 }),
	sourceId: int(),
	documentId: int().references(() => documents.id),
	status: mysqlEnum(['identified','collected','reviewed','excluded']).default('identified').notNull(),
	analysis: text(),
	exclusionReason: text(),
	addedBy: int().references(() => users.id),
	reviewedAt: bigint({ mode: "number" }),
	reviewedBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("quality_review_evidence_idx").on(table.qualityReviewId, table.category, table.status),
]);

export const qualityReviews = mysqlTable("qualityReviews", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	propertyId: int().references(() => properties.id),
	title: varchar({ length: 220 }).notNull(),
	periodStart: bigint({ mode: "number" }).notNull(),
	periodEnd: bigint({ mode: "number" }).notNull(),
	ownerUserId: int().references(() => users.id),
	status: mysqlEnum(['draft','consultation','evidence_review','report_draft','approved','submitted','overdue','closed']).default('draft').notNull(),
	methodology: text(),
	strengths: text(),
	shortfalls: text(),
	outcomesSummary: text(),
	youngPeopleSummary: text(),
	consultationSummary: text(),
	managementEvaluation: text(),
	completedAt: bigint({ mode: "number" }),
	completedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	approvedBy: int().references(() => users.id),
	reportDocumentId: int().references(() => documents.id),
	submissionDueAt: bigint({ mode: "number" }),
	submittedAt: bigint({ mode: "number" }),
	submittedBy: int().references(() => users.id),
	submissionReference: varchar({ length: 180 }),
	submissionMethod: mysqlEnum(['email','portal','secure_link','post','other']),
	submissionEvidenceDocumentId: int().references(() => documents.id),
	nextReviewDueAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("quality_review_due_idx").on(table.entityId, table.status, table.periodEnd, table.submissionDueAt),
]);

export const recordCorrections = mysqlTable("recordCorrections", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	caseId: int().references(() => dataRightsCases.id),
	placementId: int().references(() => placements.id),
	resourceType: varchar({ length: 80 }).notNull(),
	resourceId: varchar({ length: 80 }).notNull(),
	fieldPath: varchar({ length: 240 }).notNull(),
	originalValueHash: varchar({ length: 128 }).notNull(),
	originalValueCiphertext: text(),
	correctedValueCiphertext: text().notNull(),
	reason: text().notNull(),
	affectedOutputs: json(),
	notificationRecipients: json(),
	status: mysqlEnum(['proposed','approved','applied','rejected','superseded']).default('proposed').notNull(),
	approvedBy: int().references(() => users.id),
	appliedBy: int().references(() => users.id),
	appliedAt: bigint({ mode: "number" }),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("record_correction_resource_idx").on(table.resourceType, table.resourceId, table.status),
]);

export const redactionDecisions = mysqlTable("redactionDecisions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	caseId: int().notNull().references(() => dataRightsCases.id),
	resourceType: varchar({ length: 80 }).notNull(),
	resourceId: varchar({ length: 80 }).notNull(),
	fieldPath: varchar({ length: 240 }),
	documentId: int().references(() => documents.id),
	decision: mysqlEnum(['disclose','redact','withhold','partial']).notNull(),
	exemptionBasis: text(),
	rationale: text().notNull(),
	status: mysqlEnum(['draft','pending_review','approved','returned']).default('draft').notNull(),
	reviewedBy: int().references(() => users.id),
	reviewedAt: bigint({ mode: "number" }),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("redaction_case_idx").on(table.caseId, table.status),
]);

export const referenceOptions = mysqlTable("referenceOptions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().references(() => entities.id),
	category: varchar({ length: 100 }).notNull(),
	value: varchar({ length: 120 }).notNull(),
	label: varchar({ length: 180 }).notNull(),
	description: text(),
	sortOrder: int().default(0).notNull(),
	status: mysqlEnum(['active','inactive']).default('active').notNull(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("reference_option_uq").on(table.entityId, table.category, table.value),
]);

export const regulatoryRegimes = mysqlTable("regulatoryRegimes", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().references(() => entities.id),
	name: varchar({ length: 220 }).notNull(),
	jurisdiction: varchar({ length: 120 }).notNull(),
	regulator: varchar({ length: 180 }),
	sourceUrl: text(),
	effectiveFrom: bigint({ mode: "number" }).notNull(),
	effectiveTo: bigint({ mode: "number" }),
	applicability: json().notNull(),
	version: int().default(1).notNull(),
	status: mysqlEnum(['draft','in_review','approved','active','superseded','withdrawn']).default('draft').notNull(),
	supersedesId: int(),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	activatedBy: int().references(() => users.id),
	activatedAt: bigint({ mode: "number" }),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("regime_entity_status_idx").on(table.entityId, table.status, table.effectiveFrom),
]);

export const resilienceChecks = mysqlTable("resilienceChecks", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().references(() => entities.id),
	checkType: mysqlEnum(['backup','restore','database','object_storage','notification','integration','scheduled_job','audit_chain','security_monitoring']).notNull(),
	title: varchar({ length: 220 }).notNull(),
	ownerUserId: int().references(() => users.id),
	status: mysqlEnum(['planned','due','running','passed','warning','failed','waived']).default('planned').notNull(),
	frequencyDays: int(),
	lastCheckedAt: bigint({ mode: "number" }),
	nextDueAt: bigint({ mode: "number" }),
	durationMs: int(),
	evidenceDocumentId: int().references(() => documents.id),
	resultSummary: text(),
	details: json(),
	correctiveWorkPlanId: int().references(() => workPlanActions.id),
	completedBy: int().references(() => users.id),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("resilience_due_idx").on(table.entityId, table.nextDueAt, table.status),
]);

export const restraintEvents = mysqlTable("restraintEvents", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	propertyId: int().notNull().references(() => properties.id),
	placementId: int().notNull().references(() => placements.id),
	incidentId: int().references(() => incidents.id),
	interventionType: mysqlEnum(['physical','environmental','withdrawal','other']).notNull(),
	startedAt: bigint({ mode: "number" }).notNull(),
	endedAt: bigint({ mode: "number" }).notNull(),
	necessityCiphertext: text().notNull(),
	proportionalityCiphertext: text().notNull(),
	techniques: json(),
	injuriesCiphertext: text(),
	medicalAttention: mysqlEnum(['none','first_aid','nhs_111','ambulance','a_and_e','gp','other']).default('none').notNull(),
	witnesses: json(),
	youngPersonDebriefAt: bigint({ mode: "number" }),
	youngPersonFeedbackCiphertext: text(),
	staffDebriefAt: bigint({ mode: "number" }),
	staffDebriefCiphertext: text(),
	notifications: json(),
	managementReview: mysqlEnum(['pending','appropriate','learning_required','concern','escalated']).default('pending').notNull(),
	reviewNotesCiphertext: text(),
	reviewedBy: int().references(() => users.id),
	reviewedAt: bigint({ mode: "number" }),
	status: mysqlEnum(['draft','submitted','under_review','reviewed','closed']).default('submitted').notNull(),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("restraint_review_idx").on(table.entityId, table.managementReview, table.startedAt),
]);

export const scheduledActivities = mysqlTable("scheduledActivities", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	placementId: int().notNull().references(() => placements.id),
	activityType: mysqlEnum(['college','education','court','probation','health','professional','contact','other']).notNull(),
	title: varchar({ length: 220 }).notNull(),
	organisation: varchar({ length: 220 }),
	contactName: varchar({ length: 180 }),
	contactPhone: varchar({ length: 40 }),
	contactEmail: varchar({ length: 320 }),
	scheduledStart: bigint({ mode: "number" }).notNull(),
	scheduledEnd: bigint({ mode: "number" }),
	actualArrival: bigint({ mode: "number" }),
	actualDeparture: bigint({ mode: "number" }),
	attendanceStatus: mysqlEnum(['scheduled','attended','late','did_not_attend','cancelled_by_service','cancelled_by_young_person','rescheduled','not_required']).default('scheduled').notNull(),
	transport: mysqlEnum(['independent','staff','taxi','public_transport','family','authority','other']),
	outcomeCiphertext: text(),
	followUpCiphertext: text(),
	evidenceDocumentId: int().references(() => documents.id),
	acknowledgementRequired: int().default(1).notNull(),
	acknowledgedBy: int().references(() => users.id),
	acknowledgedAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("scheduled_activity_due_idx").on(table.placementId, table.scheduledStart, table.attendanceStatus),
]);

export const sharingDecisions = mysqlTable("sharingDecisions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	caseId: int().references(() => dataRightsCases.id),
	placementId: int().references(() => placements.id),
	purpose: text().notNull(),
	lawfulBasis: varchar({ length: 160 }).notNull(),
	specialCategoryCondition: varchar({ length: 200 }),
	criminalDataCondition: varchar({ length: 200 }),
	necessityAssessment: text().notNull(),
	proportionalityAssessment: text().notNull(),
	minimumFields: json().notNull(),
	recipientsCiphertext: text().notNull(),
	status: mysqlEnum(['draft','pending_approval','approved','shared','refused','expired','revoked']).default('draft').notNull(),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	expiresAt: bigint({ mode: "number" }),
	revokedBy: int().references(() => users.id),
	revokedAt: bigint({ mode: "number" }),
	revocationReason: text(),
	createdBy: int().notNull().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("sharing_decision_status_idx").on(table.entityId, table.status, table.expiresAt),
]);

export const shiftChangeAcknowledgements = mysqlTable("shiftChangeAcknowledgements", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	shiftChangeEventId: int().notNull().references(() => shiftChangeEvents.id),
	userId: int().notNull().references(() => users.id),
	status: mysqlEnum(['unread','read','acknowledged','escalated']).default('unread').notNull(),
	readAt: bigint({ mode: "number" }),
	acknowledgedAt: bigint({ mode: "number" }),
	escalatedAt: bigint({ mode: "number" }),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	uniqueIndex("shift_change_ack_uq").on(table.shiftChangeEventId, table.userId),
	index("shift_ack_user_idx").on(table.userId, table.status),
]);

export const shiftChangeEvents = mysqlTable("shiftChangeEvents", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	propertyId: int().notNull().references(() => properties.id),
	shiftId: int().notNull().references(() => shifts.id),
	eventType: mysqlEnum(['created','edited','cancelled','reassigned','opened','additional','replacement','emergency','completed']).notNull(),
	reasonKey: varchar({ length: 120 }),
	reason: text(),
	previousSnapshot: json(),
	newSnapshot: json(),
	affectedUserId: int().references(() => users.id),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("shift_change_event_idx").on(table.entityId, table.shiftId, table.createdAt),
]);

export const staffAvailability = mysqlTable("staffAvailability", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	staffProfileId: int().notNull().references(() => staffProfiles.id),
	propertyId: int().references(() => properties.id),
	availabilityType: mysqlEnum(['available','unavailable','preferred','annual_leave','sickness','training','agency_constraint','other']).notNull(),
	startsAt: bigint({ mode: "number" }).notNull(),
	endsAt: bigint({ mode: "number" }).notNull(),
	recurrence: json(),
	preferenceLevel: mysqlEnum(['required','strong','normal','avoid']).default('normal').notNull(),
	reason: varchar({ length: 500 }),
	status: mysqlEnum(['draft','active','approved','cancelled','expired']).default('active').notNull(),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("availability_staff_time_idx").on(table.staffProfileId, table.startsAt, table.endsAt, table.status),
]);

export const standardTextSnippets = mysqlTable("standardTextSnippets", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	category: varchar({ length: 100 }).notNull(),
	title: varchar({ length: 180 }).notNull(),
	body: text().notNull(),
	placeholders: json(),
	version: int().default(1).notNull(),
	status: mysqlEnum(['draft','active','retired']).default('draft').notNull(),
	reviewDueAt: bigint({ mode: "number" }),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	createdBy: int().references(() => users.id),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("standard_text_version_uq").on(table.entityId, table.category, table.title, table.version),
]);

export const workedShiftSummaries = mysqlTable("workedShiftSummaries", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	propertyId: int().notNull().references(() => properties.id),
	shiftId: int().notNull().references(() => shifts.id),
	userId: int().notNull().references(() => users.id),
	workerNameSnapshot: varchar({ length: 180 }).notNull(),
	propertyNameSnapshot: varchar({ length: 220 }).notNull(),
	scheduledMinutes: int().notNull(),
	clockedMinutes: int(),
	approvedMinutes: int(),
	staffingType: mysqlEnum(['standard','additional','replacement','emergency']).notNull(),
	replacedUserId: int().references(() => users.id),
	shiftStatus: varchar({ length: 80 }).notNull(),
	exceptionState: mysqlEnum(['none','missing_clock','off_site','overlap','policy_override','manual_adjustment']).default('none').notNull(),
	payrollState: mysqlEnum(['not_ready','ready','approved','exported','reconciled']).default('not_ready').notNull(),
	summaryGeneratedAt: bigint({ mode: "number" }).notNull(),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("worked_shift_summary_uq").on(table.shiftId, table.userId),
	index("worked_shift_property_idx").on(table.entityId, table.propertyId, table.summaryGeneratedAt),
]);

export const workingTimeExceptions = mysqlTable("workingTimeExceptions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	shiftId: int().notNull().references(() => shifts.id),
	userId: int().notNull().references(() => users.id),
	policyId: int().references(() => workingTimePolicies.id),
	exceptionType: mysqlEnum(['availability','minimum_rest','maximum_shift','maximum_weekly','night_work','break','skill','placement_need','overlap','coverage']).notNull(),
	severity: mysqlEnum(['warning','block']).default('warning').notNull(),
	detail: text().notNull(),
	overrideStatus: mysqlEnum(['not_requested','requested','approved','declined']).default('not_requested').notNull(),
	overrideReason: text(),
	overrideBy: int().references(() => users.id),
	overrideAt: bigint({ mode: "number" }),
	createdAt: timestamp().defaultNow().notNull(),
},
(table) => [
	index("working_exception_shift_idx").on(table.shiftId, table.severity, table.overrideStatus),
]);

export const workingTimePolicies = mysqlTable("workingTimePolicies", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int().notNull().references(() => entities.id),
	name: varchar({ length: 180 }).notNull(),
	minimumRestHours: decimal({ precision: 5, scale: 2 }).default('11.00').notNull(),
	maximumShiftHours: decimal({ precision: 5, scale: 2 }).default('12.00').notNull(),
	maximumWeeklyHours: decimal({ precision: 6, scale: 2 }).default('48.00').notNull(),
	nightWindowStart: varchar({ length: 5 }).default('23:00').notNull(),
	nightWindowEnd: varchar({ length: 5 }).default('06:00').notNull(),
	maximumNightHours: decimal({ precision: 5, scale: 2 }).default('8.00').notNull(),
	breakAfterHours: decimal({ precision: 5, scale: 2 }).default('6.00').notNull(),
	breakMinutes: int().default(20).notNull(),
	allowManagerOverride: int().default(1).notNull(),
	effectiveFrom: bigint({ mode: "number" }).notNull(),
	effectiveTo: bigint({ mode: "number" }),
	status: mysqlEnum(['draft','active','superseded','archived']).default('draft').notNull(),
	createdBy: int().references(() => users.id),
	approvedBy: int().references(() => users.id),
	approvedAt: bigint({ mode: "number" }),
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
},
(table) => [
		index("working_policy_effective_idx").on(table.entityId, table.status, table.effectiveFrom),
	]);

export const propertyVisitors = mysqlTable("propertyVisitors", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	propertyId: int("propertyId").notNull().references(() => properties.id),
	placementId: int("placementId").references(() => placements.id),
	visitorType: mysqlEnum("visitorType", ["friend", "relative", "professional", "contractor", "public_official", "other"]).notNull(),
	nameCiphertext: text("nameCiphertext").notNull(),
	relationshipCiphertext: text("relationshipCiphertext"),
	purposeCiphertext: text("purposeCiphertext").notNull(),
	idCheckStatus: mysqlEnum("idCheckStatus", ["not_required", "not_checked", "verified", "declined", "unavailable"]).default("not_checked").notNull(),
	identityDocumentId: int("identityDocumentId").references(() => documents.id),
	vehicleRegistrationCiphertext: text("vehicleRegistrationCiphertext"),
	arrivedAt: bigint("arrivedAt", { mode: "number" }).notNull(),
	expectedDepartureAt: bigint("expectedDepartureAt", { mode: "number" }),
	departedAt: bigint("departedAt", { mode: "number" }),
	status: mysqlEnum("status", ["on_site", "departed", "overdue", "refused"]).default("on_site").notNull(),
	notesCiphertext: text("notesCiphertext"),
	version: int("version").default(1).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	index("property_visitor_status_idx").on(table.entityId, table.propertyId, table.status, table.arrivedAt),
]);

export const propertyChecks = mysqlTable("propertyChecks", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	propertyId: int("propertyId").notNull().references(() => properties.id),
	unitId: int("unitId").references(() => propertyUnits.id),
	placementId: int("placementId").references(() => placements.id),
	shiftId: int("shiftId").references(() => shifts.id),
	checkType: mysqlEnum("checkType", ["room_check", "property_check", "fire_check", "night_check", "health_safety", "welfare", "other"]).notNull(),
	authorityBasis: mysqlEnum("authorityBasis", ["scheduled", "consent", "risk_assessment", "emergency", "policy", "other"]).notNull(),
	checklistSnapshot: json("checklistSnapshot").$type<Array<{ key: string; label: string; result: "pass" | "fail" | "not_applicable"; note?: string }>>().notNull(),
	findingsCiphertext: text("findingsCiphertext"),
	privacyNotesCiphertext: text("privacyNotesCiphertext"),
	youngPersonPresent: int("youngPersonPresent").default(0).notNull(),
	result: mysqlEnum("result", ["pass", "issues_found", "urgent_action"]).notNull(),
	status: mysqlEnum("status", ["draft", "submitted", "reviewed", "returned", "closed"]).default("draft").notNull(),
	completedAt: bigint("completedAt", { mode: "number" }),
	reviewedBy: int("reviewedBy").references(() => users.id),
	reviewedAt: bigint("reviewedAt", { mode: "number" }),
	reviewNotesCiphertext: text("reviewNotesCiphertext"),
	version: int("version").default(1).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	index("property_check_status_idx").on(table.entityId, table.propertyId, table.status, table.createdAt),
]);

export const maintenanceJobs = mysqlTable("maintenanceJobs", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	propertyId: int("propertyId").notNull().references(() => properties.id),
	unitId: int("unitId").references(() => propertyUnits.id),
	propertyCheckId: int("propertyCheckId").references(() => propertyChecks.id),
	incidentId: int("incidentId").references(() => incidents.id),
	title: varchar("title", { length: 220 }).notNull(),
	category: mysqlEnum("category", ["plumbing", "electrical", "heating", "fire_safety", "security", "furniture", "appliance", "fabric", "pest", "cleaning", "other"]).notNull(),
	priority: mysqlEnum("priority", ["routine", "urgent", "emergency"]).default("routine").notNull(),
	descriptionCiphertext: text("descriptionCiphertext").notNull(),
	accessNotesCiphertext: text("accessNotesCiphertext"),
	assignedUserId: int("assignedUserId").references(() => users.id),
	contractorName: varchar("contractorName", { length: 220 }),
	status: mysqlEnum("status", ["reported", "triaged", "assigned", "scheduled", "in_progress", "completed", "verified", "cancelled", "reopened"]).default("reported").notNull(),
	targetAt: bigint("targetAt", { mode: "number" }),
	appointmentStart: bigint("appointmentStart", { mode: "number" }),
	appointmentEnd: bigint("appointmentEnd", { mode: "number" }),
	completedAt: bigint("completedAt", { mode: "number" }),
	verifiedBy: int("verifiedBy").references(() => users.id),
	verifiedAt: bigint("verifiedAt", { mode: "number" }),
	version: int("version").default(1).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	index("maintenance_job_queue_idx").on(table.entityId, table.propertyId, table.status, table.priority),
]);

export const maintenanceUpdates = mysqlTable("maintenanceUpdates", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	maintenanceJobId: int("maintenanceJobId").notNull().references(() => maintenanceJobs.id),
	updateType: mysqlEnum("updateType", ["note", "status_change", "appointment", "contractor_visit", "evidence", "completion", "reopen"]).notNull(),
	statusFrom: varchar("statusFrom", { length: 40 }),
	statusTo: varchar("statusTo", { length: 40 }),
	noteCiphertext: text("noteCiphertext"),
	documentId: int("documentId").references(() => documents.id),
	occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("maintenance_update_job_idx").on(table.maintenanceJobId, table.occurredAt),
]);

export const loneWorkerSessions = mysqlTable("loneWorkerSessions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	propertyId: int("propertyId").notNull().references(() => properties.id),
	shiftId: int("shiftId").notNull().references(() => shifts.id),
	userId: int("userId").notNull().references(() => users.id),
	startsAt: bigint("startsAt", { mode: "number" }).notNull(),
	expectedEndAt: bigint("expectedEndAt", { mode: "number" }).notNull(),
	checkInIntervalMinutes: int("checkInIntervalMinutes").default(60).notNull(),
	escalationAfterMinutes: int("escalationAfterMinutes").default(15).notNull(),
	nextCheckInDueAt: bigint("nextCheckInDueAt", { mode: "number" }).notNull(),
	lastCheckInAt: bigint("lastCheckInAt", { mode: "number" }),
	status: mysqlEnum("status", ["active", "overdue", "escalated", "completed", "cancelled"]).default("active").notNull(),
	escalatedAt: bigint("escalatedAt", { mode: "number" }),
	escalationNoteCiphertext: text("escalationNoteCiphertext"),
	completedAt: bigint("completedAt", { mode: "number" }),
	version: int("version").default(1).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	uniqueIndex("lone_worker_shift_user_uq").on(table.shiftId, table.userId),
	index("lone_worker_due_idx").on(table.entityId, table.status, table.nextCheckInDueAt),
]);

export const loneWorkerCheckIns = mysqlTable("loneWorkerCheckIns", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	sessionId: int("sessionId").notNull().references(() => loneWorkerSessions.id),
	checkInType: mysqlEnum("checkInType", ["scheduled", "manual", "help_requested", "session_end"]).notNull(),
	wellbeingStatus: mysqlEnum("wellbeingStatus", ["safe", "concern", "help_required"]).default("safe").notNull(),
	occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
	latitude: decimal("latitude", { precision: 10, scale: 7 }),
	longitude: decimal("longitude", { precision: 10, scale: 7 }),
	accuracyMetres: decimal("accuracyMetres", { precision: 10, scale: 2 }),
	locationState: mysqlEnum("locationState", ["on_site", "off_site", "unavailable", "manual"]).notNull(),
	noteCiphertext: text("noteCiphertext"),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("lone_worker_checkin_idx").on(table.sessionId, table.occurredAt),
]);

export const residentFinanceAccounts = mysqlTable("residentFinanceAccounts", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	placementId: int("placementId").notNull().references(() => placements.id),
	accountType: mysqlEnum("accountType", ["cash_allowance", "savings", "personal_budget", "petty_cash", "other"]).notNull(),
	name: varchar("name", { length: 180 }).notNull(),
	currency: varchar("currency", { length: 3 }).default("GBP").notNull(),
	balance: decimal("balance", { precision: 12, scale: 2 }).default("0.00").notNull(),
	status: mysqlEnum("status", ["active", "frozen", "closed"]).default("active").notNull(),
	version: int("version").default(1).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	index("resident_finance_account_idx").on(table.entityId, table.placementId, table.status),
]);

export const residentFinanceTransactions = mysqlTable("residentFinanceTransactions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	placementId: int("placementId").notNull().references(() => placements.id),
	accountId: int("accountId").notNull().references(() => residentFinanceAccounts.id),
	transactionType: mysqlEnum("transactionType", ["deposit", "withdrawal", "purchase", "refund", "adjustment", "reversal"]).notNull(),
	amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
	balanceAfter: decimal("balanceAfter", { precision: 12, scale: 2 }).notNull(),
	purposeCiphertext: text("purposeCiphertext").notNull(),
	counterpartyCiphertext: text("counterpartyCiphertext"),
	receiptDocumentId: int("receiptDocumentId").references(() => documents.id),
	occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
	status: mysqlEnum("status", ["draft", "submitted", "approved", "returned", "reversed"]).default("submitted").notNull(),
	reviewNotesCiphertext: text("reviewNotesCiphertext"),
	approvedBy: int("approvedBy").references(() => users.id),
	approvedAt: bigint("approvedAt", { mode: "number" }),
	reversedBy: int("reversedBy").references(() => users.id),
	reversedAt: bigint("reversedAt", { mode: "number" }),
	reversalReasonCiphertext: text("reversalReasonCiphertext"),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("resident_finance_transaction_idx").on(table.accountId, table.occurredAt, table.status),
]);

export const residentValuables = mysqlTable("residentValuables", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	placementId: int("placementId").notNull().references(() => placements.id),
	reference: varchar("reference", { length: 80 }).notNull(),
	descriptionCiphertext: text("descriptionCiphertext").notNull(),
	quantity: int("quantity").default(1).notNull(),
	receivedAt: bigint("receivedAt", { mode: "number" }).notNull(),
	releasedAt: bigint("releasedAt", { mode: "number" }),
	status: mysqlEnum("status", ["held", "released", "missing", "disposed"]).default("held").notNull(),
	witnessUserId: int("witnessUserId").references(() => users.id),
	documentId: int("documentId").references(() => documents.id),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	uniqueIndex("resident_valuable_reference_uq").on(table.entityId, table.reference),
	index("resident_valuable_placement_idx").on(table.placementId, table.status),
]);

export const staffRequests = mysqlTable("staffRequests", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	staffProfileId: int("staffProfileId").notNull().references(() => staffProfiles.id),
	userId: int("userId").notNull().references(() => users.id),
	requestType: mysqlEnum("requestType", ["contact_change", "certificate_submission", "sickness", "holiday", "availability_change"]).notNull(),
	startsAt: bigint("startsAt", { mode: "number" }),
	endsAt: bigint("endsAt", { mode: "number" }),
	detailsCiphertext: text("detailsCiphertext").notNull(),
	proposedChanges: json("proposedChanges").$type<Record<string, unknown>>(),
	evidenceDocumentId: int("evidenceDocumentId").references(() => documents.id),
	status: mysqlEnum("status", ["draft", "submitted", "approved", "declined", "returned", "withdrawn"]).default("submitted").notNull(),
	reviewNotesCiphertext: text("reviewNotesCiphertext"),
	reviewedBy: int("reviewedBy").references(() => users.id),
	reviewedAt: bigint("reviewedAt", { mode: "number" }),
	version: int("version").default(1).notNull(),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	index("staff_request_queue_idx").on(table.entityId, table.status, table.requestType, table.createdAt),
	index("staff_request_user_idx").on(table.userId, table.status, table.createdAt),
]);

export const supervisionSessions = mysqlTable("supervisionSessions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	staffProfileId: int("staffProfileId").notNull().references(() => staffProfiles.id),
	managerUserId: int("managerUserId").notNull().references(() => users.id),
	templateId: int("templateId").references(() => documentTemplates.id),
	scheduledAt: bigint("scheduledAt", { mode: "number" }).notNull(),
	completedAt: bigint("completedAt", { mode: "number" }),
	location: varchar("location", { length: 220 }),
	sharedNotesCiphertext: text("sharedNotesCiphertext"),
	managerNotesCiphertext: text("managerNotesCiphertext"),
	actions: json("actions").$type<Array<{ title: string; ownerUserId?: number; dueAt?: number; completedAt?: number }>>(),
	acknowledgementRequired: int("acknowledgementRequired").default(1).notNull(),
	acknowledgedBy: int("acknowledgedBy").references(() => users.id),
	acknowledgedAt: bigint("acknowledgedAt", { mode: "number" }),
	status: mysqlEnum("status", ["scheduled", "draft", "submitted", "acknowledged", "completed", "cancelled"]).default("scheduled").notNull(),
	version: int("version").default(1).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	index("supervision_due_idx").on(table.entityId, table.staffProfileId, table.status, table.scheduledAt),
]);

export const medicationStockTransactions = mysqlTable("medicationStockTransactions", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	placementId: int("placementId").notNull().references(() => placements.id),
	medicationId: int("medicationId").notNull().references(() => medications.id),
	administrationId: int("administrationId").references(() => medicationAdministrations.id),
	transactionType: mysqlEnum("transactionType", ["receipt", "administration", "return", "disposal", "correction", "count"]).notNull(),
	quantity: decimal("quantity", { precision: 10, scale: 3 }).notNull(),
	balanceAfter: decimal("balanceAfter", { precision: 10, scale: 3 }).notNull(),
	unit: varchar("unit", { length: 60 }).notNull(),
	batchReference: varchar("batchReference", { length: 120 }),
	expiresAt: bigint("expiresAt", { mode: "number" }),
	occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
	reasonCiphertext: text("reasonCiphertext"),
	witnessUserId: int("witnessUserId").references(() => users.id),
	documentId: int("documentId").references(() => documents.id),
	status: mysqlEnum("status", ["recorded", "review_required", "approved"]).default("recorded").notNull(),
	reviewedBy: int("reviewedBy").references(() => users.id),
	reviewedAt: bigint("reviewedAt", { mode: "number" }),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("medication_stock_idx").on(table.medicationId, table.occurredAt, table.status),
]);

export const incidentPeople = mysqlTable("incidentPeople", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	incidentId: int("incidentId").notNull().references(() => incidents.id),
	personType: mysqlEnum("personType", ["young_person", "staff", "professional", "visitor", "public", "other"]).notNull(),
	placementId: int("placementId").references(() => placements.id),
	userId: int("userId").references(() => users.id),
	nameCiphertext: text("nameCiphertext"),
	contactCiphertext: text("contactCiphertext"),
	roleDescription: varchar("roleDescription", { length: 180 }),
	involvement: mysqlEnum("involvement", ["affected", "witness", "reporter", "person_of_concern", "responding_professional", "other"]).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("incident_people_idx").on(table.incidentId, table.involvement),
]);

export const incidentReferences = mysqlTable("incidentReferences", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	incidentId: int("incidentId").notNull().references(() => incidents.id),
	referenceType: mysqlEnum("referenceType", ["police", "nhs", "local_authority", "ofsted", "lado", "insurance", "other"]).notNull(),
	referenceValueCiphertext: text("referenceValueCiphertext").notNull(),
	organisation: varchar("organisation", { length: 220 }),
	notesCiphertext: text("notesCiphertext"),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("incident_reference_idx").on(table.incidentId, table.referenceType),
]);

export const recordDocumentLinks = mysqlTable("recordDocumentLinks", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	documentId: int("documentId").notNull().references(() => documents.id),
	resourceType: varchar("resourceType", { length: 80 }).notNull(),
	resourceId: varchar("resourceId", { length: 80 }).notNull(),
	linkType: mysqlEnum("linkType", ["evidence", "photo", "id_document", "receipt", "certificate", "statement", "completion", "other"]).notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	uniqueIndex("record_document_link_uq").on(table.documentId, table.resourceType, table.resourceId, table.linkType),
	index("record_document_resource_idx").on(table.resourceType, table.resourceId),
]);

export const keyWorkerReportReviews = mysqlTable("keyWorkerReportReviews", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	reportId: int("reportId").notNull().references(() => keyWorkerReports.id),
	decision: mysqlEnum("decision", ["returned", "reviewed", "approved", "locked", "addendum_requested"]).notNull(),
	notesCiphertext: text("notesCiphertext"),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("key_worker_report_review_idx").on(table.reportId, table.createdAt),
]);

export const incidentReviews = mysqlTable("incidentReviews", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	incidentId: int("incidentId").notNull().references(() => incidents.id),
	decision: mysqlEnum("decision", ["started", "returned", "approved", "follow_up", "closed"]).notNull(),
	notesCiphertext: text("notesCiphertext"),
	notificationAssessment: mysqlEnum("notificationAssessment", ["unchanged", "not_notifiable", "regulation_27", "other_notification"]).default("unchanged").notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("incident_review_idx").on(table.incidentId, table.createdAt),
]);

export type Entity = typeof entities.$inferSelect;
export const shiftBreaks = mysqlTable("shiftBreaks", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), propertyId: int("propertyId").notNull().references(() => properties.id), shiftId: int("shiftId").notNull().references(() => shifts.id), userId: int("userId").notNull().references(() => users.id), startClockEventId: int("startClockEventId").references(() => clockEvents.id), endClockEventId: int("endClockEventId").references(() => clockEvents.id), startedAt: bigint("startedAt", { mode: "number" }).notNull(), endedAt: bigint("endedAt", { mode: "number" }), plannedMinutes: int("plannedMinutes"), actualMinutes: int("actualMinutes"), status: mysqlEnum("status", ["active", "completed", "missed", "adjusted"]).default("active").notNull(), exceptionReasonCiphertext: text("exceptionReasonCiphertext"), approvedBy: int("approvedBy").references(() => users.id), approvedAt: bigint("approvedAt", { mode: "number" }), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("shift_break_user_idx").on(table.shiftId, table.userId, table.startedAt)]);

export const propertyPresenceEvents = mysqlTable("propertyPresenceEvents", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), propertyId: int("propertyId").notNull().references(() => properties.id), shiftId: int("shiftId").references(() => shifts.id), placementId: int("placementId").references(() => placements.id), visitorId: int("visitorId").references(() => propertyVisitors.id), userId: int("userId").references(() => users.id), personType: mysqlEnum("personType", ["young_person", "visitor", "staff", "professional", "contractor", "other"]).notNull(), eventType: mysqlEnum("eventType", ["arrived", "departed", "expected", "absent", "located", "verified"]).notNull(), presenceState: mysqlEnum("presenceState", ["present", "off_site", "unknown"]).notNull(), source: mysqlEnum("source", ["manual", "visitor_log", "curfew", "shift", "incident", "emergency_roll_call"]).default("manual").notNull(), occurredAt: bigint("occurredAt", { mode: "number" }).notNull(), noteCiphertext: text("noteCiphertext"), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("property_presence_idx").on(table.propertyId, table.occurredAt, table.personType)]);

export const emergencyRollCalls = mysqlTable("emergencyRollCalls", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), propertyId: int("propertyId").notNull().references(() => properties.id), shiftId: int("shiftId").references(() => shifts.id), reason: mysqlEnum("reason", ["fire", "evacuation", "missing", "security", "drill", "other"]).notNull(), initiatedAt: bigint("initiatedAt", { mode: "number" }).notNull(), completedAt: bigint("completedAt", { mode: "number" }), status: mysqlEnum("status", ["open", "completed", "cancelled"]).default("open").notNull(), notesCiphertext: text("notesCiphertext"), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("emergency_roll_call_idx").on(table.propertyId, table.status, table.initiatedAt)]);

export const emergencyRollCallEntries = mysqlTable("emergencyRollCallEntries", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), rollCallId: int("rollCallId").notNull().references(() => emergencyRollCalls.id), personType: mysqlEnum("personType", ["young_person", "visitor", "staff", "professional", "contractor", "other"]).notNull(), placementId: int("placementId").references(() => placements.id), visitorId: int("visitorId").references(() => propertyVisitors.id), userId: int("userId").references(() => users.id), nameSnapshotCiphertext: text("nameSnapshotCiphertext"), expectedState: mysqlEnum("expectedState", ["expected", "not_expected", "unknown"]).default("unknown").notNull(), accountedState: mysqlEnum("accountedState", ["present", "absent", "left", "unknown"]).default("unknown").notNull(), accountedAt: bigint("accountedAt", { mode: "number" }), noteCiphertext: text("noteCiphertext"), verifiedBy: int("verifiedBy").references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [uniqueIndex("roll_call_person_uq").on(table.rollCallId, table.personType, table.placementId, table.visitorId, table.userId), index("roll_call_entry_idx").on(table.rollCallId, table.accountedState)]);

export const supportGoals = mysqlTable("supportGoals", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), placementId: int("placementId").notNull().references(() => placements.id), carePlanId: int("carePlanId").references(() => carePlans.id), title: varchar("title", { length: 220 }).notNull(), descriptionCiphertext: text("descriptionCiphertext"), outcomeArea: varchar("outcomeArea", { length: 160 }), targetAt: bigint("targetAt", { mode: "number" }), progress: int("progress").default(0).notNull(), status: mysqlEnum("status", ["planned", "active", "achieved", "paused", "not_achieved", "cancelled"]).default("planned").notNull(), youngPersonViewCiphertext: text("youngPersonViewCiphertext"), reviewDueAt: bigint("reviewDueAt", { mode: "number" }), version: int("version").default(1).notNull(), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("support_goal_placement_idx").on(table.placementId, table.status, table.reviewDueAt)]);

export const keyworkSessions = mysqlTable("keyworkSessions", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), propertyId: int("propertyId").notNull().references(() => properties.id), placementId: int("placementId").notNull().references(() => placements.id), shiftId: int("shiftId").references(() => shifts.id), goalId: int("goalId").references(() => supportGoals.id), topic: varchar("topic", { length: 220 }).notNull(), occurredAt: bigint("occurredAt", { mode: "number" }).notNull(), durationMinutes: int("durationMinutes"), objectivesCiphertext: text("objectivesCiphertext"), discussionCiphertext: text("discussionCiphertext").notNull(), youngPersonViewCiphertext: text("youngPersonViewCiphertext"), outcomeCiphertext: text("outcomeCiphertext"), actions: json("actions").$type<Array<{ title: string; ownerUserId?: number; dueAt?: number }>>(), status: mysqlEnum("status", ["draft", "submitted", "reviewed", "returned", "approved"]).default("draft").notNull(), reviewedBy: int("reviewedBy").references(() => users.id), reviewedAt: bigint("reviewedAt", { mode: "number" }), reviewNotesCiphertext: text("reviewNotesCiphertext"), version: int("version").default(1).notNull(), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("keywork_session_placement_idx").on(table.placementId, table.occurredAt, table.status)]);

export const dailyNotes = mysqlTable("dailyNotes", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), propertyId: int("propertyId").notNull().references(() => properties.id), placementId: int("placementId").notNull().references(() => placements.id), shiftId: int("shiftId").references(() => shifts.id), noteType: mysqlEnum("noteType", ["observation", "contact", "appointment", "achievement", "concern", "activity", "education", "health", "other"]).notNull(), observedAt: bigint("observedAt", { mode: "number" }).notNull(), contentCiphertext: text("contentCiphertext").notNull(), youngPersonViewCiphertext: text("youngPersonViewCiphertext"), tags: json("tags").$type<string[]>(), status: mysqlEnum("status", ["draft", "submitted", "reviewed", "returned"]).default("draft").notNull(), reviewedBy: int("reviewedBy").references(() => users.id), reviewedAt: bigint("reviewedAt", { mode: "number" }), version: int("version").default(1).notNull(), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("daily_note_placement_idx").on(table.placementId, table.observedAt, table.status)]);

export const recordLinks = mysqlTable("recordLinks", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), fromResourceType: varchar("fromResourceType", { length: 80 }).notNull(), fromResourceId: varchar("fromResourceId", { length: 80 }).notNull(), toResourceType: varchar("toResourceType", { length: 80 }).notNull(), toResourceId: varchar("toResourceId", { length: 80 }).notNull(), linkType: mysqlEnum("linkType", ["source", "supports", "resulted_in", "supersedes", "related", "follow_up"]).default("related").notNull(), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [uniqueIndex("record_link_uq").on(table.fromResourceType, table.fromResourceId, table.toResourceType, table.toResourceId, table.linkType), index("record_link_target_idx").on(table.toResourceType, table.toResourceId)]);

export const safeguardingConcerns = mysqlTable("safeguardingConcerns", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), propertyId: int("propertyId").notNull().references(() => properties.id), placementId: int("placementId").notNull().references(() => placements.id), incidentId: int("incidentId").references(() => incidents.id), complaintId: int("complaintId").references(() => complaints.id), allegationId: int("allegationId").references(() => allegations.id), concernType: mysqlEnum("concernType", ["disclosure", "observation", "exploitation", "abuse", "neglect", "self_harm", "online_safety", "criminality", "other"]).notNull(), riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high", "critical"]).notNull(), summaryCiphertext: text("summaryCiphertext").notNull(), immediateProtectionCiphertext: text("immediateProtectionCiphertext").notNull(), youngPersonViewCiphertext: text("youngPersonViewCiphertext"), status: mysqlEnum("status", ["submitted", "triage", "referred", "investigating", "action_plan", "closed"]).default("submitted").notNull(), restrictedOwnerUserId: int("restrictedOwnerUserId").references(() => users.id), reviewDueAt: bigint("reviewDueAt", { mode: "number" }), closedAt: bigint("closedAt", { mode: "number" }), version: int("version").default(1).notNull(), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("safeguarding_concern_queue_idx").on(table.entityId, table.status, table.riskLevel, table.reviewDueAt)]);

export const investigations = mysqlTable("investigations", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), propertyId: int("propertyId").references(() => properties.id), placementId: int("placementId").references(() => placements.id), concernId: int("concernId").references(() => safeguardingConcerns.id), incidentId: int("incidentId").references(() => incidents.id), complaintId: int("complaintId").references(() => complaints.id), allegationId: int("allegationId").references(() => allegations.id), investigationType: mysqlEnum("investigationType", ["safeguarding", "complaint", "incident", "staff_conduct", "finance", "medication", "property", "other"]).notNull(), termsCiphertext: text("termsCiphertext").notNull(), leadUserId: int("leadUserId").notNull().references(() => users.id), independentReviewerUserId: int("independentReviewerUserId").references(() => users.id), openedAt: bigint("openedAt", { mode: "number" }).notNull(), dueAt: bigint("dueAt", { mode: "number" }), outcomeCiphertext: text("outcomeCiphertext"), learningCiphertext: text("learningCiphertext"), status: mysqlEnum("status", ["open", "evidence_gathering", "awaiting_response", "review", "action_plan", "closed", "cancelled"]).default("open").notNull(), closedAt: bigint("closedAt", { mode: "number" }), version: int("version").default(1).notNull(), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("investigation_queue_idx").on(table.entityId, table.status, table.dueAt)]);

export const investigationActions = mysqlTable("investigationActions", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), investigationId: int("investigationId").notNull().references(() => investigations.id), workPlanActionId: int("workPlanActionId").references(() => workPlanActions.id), title: varchar("title", { length: 220 }).notNull(), ownerUserId: int("ownerUserId").references(() => users.id), dueAt: bigint("dueAt", { mode: "number" }), status: mysqlEnum("status", ["open", "in_progress", "complete", "cancelled"]).default("open").notNull(), completionNotesCiphertext: text("completionNotesCiphertext"), completedAt: bigint("completedAt", { mode: "number" }), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("investigation_action_idx").on(table.investigationId, table.status, table.dueAt)]);

export const medicationDiscrepancies = mysqlTable("medicationDiscrepancies", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), placementId: int("placementId").notNull().references(() => placements.id), medicationId: int("medicationId").notNull().references(() => medications.id), administrationId: int("administrationId").references(() => medicationAdministrations.id), stockTransactionId: int("stockTransactionId").references(() => medicationStockTransactions.id), discrepancyType: mysqlEnum("discrepancyType", ["missing_stock", "excess_stock", "wrong_dose", "wrong_time", "wrong_person", "recording_error", "storage", "expiry", "other"]).notNull(), expectedQuantity: decimal("expectedQuantity", { precision: 10, scale: 3 }), actualQuantity: decimal("actualQuantity", { precision: 10, scale: 3 }), detailsCiphertext: text("detailsCiphertext").notNull(), immediateActionsCiphertext: text("immediateActionsCiphertext").notNull(), status: mysqlEnum("status", ["open", "under_review", "action_required", "resolved", "closed"]).default("open").notNull(), reviewedBy: int("reviewedBy").references(() => users.id), reviewedAt: bigint("reviewedAt", { mode: "number" }), resolutionCiphertext: text("resolutionCiphertext"), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("medication_discrepancy_idx").on(table.entityId, table.status, table.createdAt)]);

export const residentFinanceReconciliations = mysqlTable("residentFinanceReconciliations", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), placementId: int("placementId").notNull().references(() => placements.id), accountId: int("accountId").notNull().references(() => residentFinanceAccounts.id), workPlanActionId: int("workPlanActionId").references(() => workPlanActions.id), periodStart: bigint("periodStart", { mode: "number" }).notNull(), periodEnd: bigint("periodEnd", { mode: "number" }).notNull(), openingBalance: decimal("openingBalance", { precision: 12, scale: 2 }).notNull(), expectedClosingBalance: decimal("expectedClosingBalance", { precision: 12, scale: 2 }).notNull(), actualClosingBalance: decimal("actualClosingBalance", { precision: 12, scale: 2 }).notNull(), difference: decimal("difference", { precision: 12, scale: 2 }).notNull(), notesCiphertext: text("notesCiphertext"), status: mysqlEnum("status", ["draft", "submitted", "balanced", "discrepancy", "approved", "returned"]).default("draft").notNull(), reviewedBy: int("reviewedBy").references(() => users.id), reviewedAt: bigint("reviewedAt", { mode: "number" }), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("resident_reconciliation_period_uq").on(table.accountId, table.periodStart, table.periodEnd), index("resident_reconciliation_idx").on(table.entityId, table.status, table.periodEnd)]);

export const residentFinanceDiscrepancies = mysqlTable("residentFinanceDiscrepancies", {
	id: int("id").autoincrement().primaryKey(), entityId: int("entityId").notNull().references(() => entities.id), placementId: int("placementId").notNull().references(() => placements.id), accountId: int("accountId").notNull().references(() => residentFinanceAccounts.id), transactionId: int("transactionId").references(() => residentFinanceTransactions.id), reconciliationId: int("reconciliationId").references(() => residentFinanceReconciliations.id), workPlanActionId: int("workPlanActionId").references(() => workPlanActions.id), discrepancyType: mysqlEnum("discrepancyType", ["cash_short", "cash_over", "missing_receipt", "duplicate", "unauthorised", "calculation", "other"]).notNull(), amount: decimal("amount", { precision: 12, scale: 2 }), detailsCiphertext: text("detailsCiphertext").notNull(), immediateActionsCiphertext: text("immediateActionsCiphertext"), status: mysqlEnum("status", ["open", "under_review", "action_required", "resolved", "closed"]).default("open").notNull(), reviewedBy: int("reviewedBy").references(() => users.id), reviewedAt: bigint("reviewedAt", { mode: "number" }), resolutionCiphertext: text("resolutionCiphertext"), createdBy: int("createdBy").notNull().references(() => users.id), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("resident_finance_discrepancy_idx").on(table.entityId, table.status, table.createdAt)]);

export const keyWorkerReportSources = mysqlTable("keyWorkerReportSources", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	reportId: int("reportId").notNull().references(() => keyWorkerReports.id),
	sourceType: mysqlEnum("sourceType", ["keywork_session", "daily_note", "support_goal", "appointment", "incident", "curfew_check", "medication", "finance"]).notNull(),
	sourceId: varchar("sourceId", { length: 80 }).notNull(),
	linkReason: mysqlEnum("linkReason", ["included", "summarised", "follow_up", "evidence"]).default("included").notNull(),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	uniqueIndex("report_source_uq").on(table.reportId, table.sourceType, table.sourceId),
	index("report_source_lookup_idx").on(table.sourceType, table.sourceId),
]);

export const medicationSelfAdministrationEvents = mysqlTable("medicationSelfAdministrationEvents", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	placementId: int("placementId").notNull().references(() => placements.id),
	medicationId: int("medicationId").notNull().references(() => medications.id),
	administrationId: int("administrationId").references(() => medicationAdministrations.id),
	stockTransactionId: int("stockTransactionId").references(() => medicationStockTransactions.id),
	discrepancyId: int("discrepancyId").references(() => medicationDiscrepancies.id),
	eventType: mysqlEnum("eventType", ["assessment", "authorised", "supported", "self_administered", "observed", "withheld", "reviewed", "revoked"]).notNull(),
	outcome: mysqlEnum("outcome", ["safe", "support_required", "not_safe", "completed", "refused", "omitted", "not_applicable"]).notNull(),
	occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
	detailsCiphertext: text("detailsCiphertext").notNull(),
	competencySnapshot: json("competencySnapshot").$type<Record<string, boolean | string | number>>(),
	nextReviewAt: bigint("nextReviewAt", { mode: "number" }),
	reviewedBy: int("reviewedBy").references(() => users.id),
	createdBy: int("createdBy").notNull().references(() => users.id),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
	index("med_self_admin_idx").on(table.medicationId, table.occurredAt, table.eventType),
]);

export const notificationChannelDeliveries = mysqlTable("notificationChannelDeliveries", {
	id: int("id").autoincrement().primaryKey(),
	entityId: int("entityId").notNull().references(() => entities.id),
	notificationId: int("notificationId").references(() => notifications.id),
	userId: int("userId").notNull().references(() => users.id),
	channel: mysqlEnum("channel", ["push", "email", "sms"]).notNull(),
	status: mysqlEnum("status", ["pending", "provider_inactive", "queued", "processing", "delivered", "failed", "cancelled"]).default("pending").notNull(),
	providerConnectionId: int("providerConnectionId").references(() => integrationConnections.id),
	idempotencyKey: varchar("idempotencyKey", { length: 220 }).notNull(),
	recipientHint: varchar("recipientHint", { length: 160 }),
	payloadSnapshot: json("payloadSnapshot").$type<{ title: string; body: string; deepLink?: string; containsSensitiveDetails: false }>().notNull(),
	attemptCount: int("attemptCount").default(0).notNull(),
	nextAttemptAt: bigint("nextAttemptAt", { mode: "number" }),
	providerReference: varchar("providerReference", { length: 200 }),
	deliveredAt: bigint("deliveredAt", { mode: "number" }),
	lastError: text("lastError"),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
	updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
	uniqueIndex("notification_channel_delivery_uq").on(table.idempotencyKey),
	index("notification_channel_queue_idx").on(table.entityId, table.channel, table.status, table.nextAttemptAt),
]);

export type Property = typeof properties.$inferSelect;
export type StaffProfile = typeof staffProfiles.$inferSelect;
export type YoungPerson = typeof youngPeople.$inferSelect;
export type Placement = typeof placements.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type ComplianceObligation = typeof complianceObligations.$inferSelect;
export type WorkPlanAction = typeof workPlanActions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
