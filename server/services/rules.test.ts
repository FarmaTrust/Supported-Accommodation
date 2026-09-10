import { describe, expect, it } from "vitest";
import { calculateDistanceMetres, calculateInvoiceLine, calculateRagStatus, classifyDeadline, formatInvoiceNumber } from "./rules";

const day = 86_400_000;
const now = Date.UTC(2026, 7, 25, 9, 0, 0);

describe("compliance RAG", () => {
  it("marks completed evidence green regardless of due date", () => expect(calculateRagStatus(now - day, now - 2 * day, 30, now)).toBe("green"));
  it("marks missing due dates grey", () => expect(calculateRagStatus(null, null, 30, now)).toBe("grey"));
  it("marks past deadlines red", () => expect(calculateRagStatus(now - 1, null, 30, now)).toBe("red"));
  it("marks deadlines inside the lead window amber", () => expect(calculateRagStatus(now + 14 * day, null, 30, now)).toBe("amber"));
  it("marks later deadlines green", () => expect(calculateRagStatus(now + 31 * day, null, 30, now)).toBe("green"));
});

describe("scheduled reminder boundaries", () => {
  it("classifies overdue, due-window and future records deterministically", () => {
    expect(classifyDeadline(now - 1, 7, now)).toBe("overdue");
    expect(classifyDeadline(now + 7 * day, 7, now)).toBe("due");
    expect(classifyDeadline(now + 7 * day + 1, 7, now)).toBe("not_due");
  });
});

describe("invoice rules", () => {
  it("calculates net, VAT and gross to currency precision", () => {
    expect(calculateInvoiceLine(4, 1375.25, 20)).toEqual({ net: 5501, vat: 1100.2, gross: 6601.2 });
  });

  it("supports zero and exempt VAT calculations", () => {
    expect(calculateInvoiceLine(1, 5500, 0)).toEqual({ net: 5500, vat: 0, gross: 5500 });
  });

  it("formats collision-resistant sequence labels consistently", () => {
    expect(formatInvoiceNumber("INV", 1)).toBe("INV-000001");
    expect(formatInvoiceNumber("NORTH-26", 412)).toBe("NORTH-26-000412");
    expect(() => formatInvoiceNumber("bad prefix", 1)).toThrow("Invalid invoice prefix");
    expect(() => formatInvoiceNumber("INV", 0)).toThrow("Invalid invoice sequence");
  });
});

describe("location verification", () => {
  it("returns zero for identical coordinates", () => expect(calculateDistanceMetres(51.5, -0.1, 51.5, -0.1)).toBe(0));
  it("returns a plausible short distance in metres", () => {
    const distance = calculateDistanceMetres(51.5000, -0.1000, 51.5005, -0.1000);
    expect(distance).toBeGreaterThan(50);
    expect(distance).toBeLessThan(60);
  });
});
