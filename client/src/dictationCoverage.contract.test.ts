import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const narrativeForms = [
  "src/components/ManagerRotaCalendar.tsx",
  "src/components/TemporaryLoginLinksPanel.tsx",
  "src/components/VisitorLogDialog.tsx",
  "src/pages/AccessControl.tsx",
  "src/pages/Assurance.tsx",
  "src/pages/CareOperations.tsx",
  "src/pages/Compliance.tsx",
  "src/pages/Documents.tsx",
  "src/pages/GovernanceHub.tsx",
  "src/pages/InvoiceDetail.tsx",
  "src/pages/KeyWorker.tsx",
  "src/pages/KeyWorkerApp.tsx",
  "src/pages/ManagerApp.tsx",
  "src/pages/Placements.tsx",
  "src/pages/QualityReviews.tsx",
  "src/pages/Regulation28.tsx",
  "src/pages/Rota.tsx",
  "src/pages/RotaControls.tsx",
  "src/pages/Safeguarding.tsx",
  "src/pages/StaffWorkspace.tsx",
  "src/pages/WorkPlans.tsx",
  "src/pages/Workforce.tsx",
];

describe("narrative dictation coverage", () => {
  it("places reusable microphone controls beside every operational multiline narrative field", () => {
    for (const path of narrativeForms) {
      const source = read(path);
      expect(source, path).toContain("DictationTextarea");
      expect(source, path).not.toContain("<Textarea");
    }
  });

  it("adds microphone controls to every guided Key Worker report prompt and incident summary", () => {
    const source = read("src/pages/KeyWorker.tsx");
    expect(source).toContain("DictationInput label={label}");
    expect(source).toContain("DictationTextarea label={label}");
    expect(source).toContain('label="Concise factual summary"');
    expect(source).toContain("DictationFieldGuidance");
  });

  it("maintains left-aligned, legible mobile narrative text", () => {
    const styles = read("src/index.css");
    expect(styles).toContain('@media (max-width: 639px)');
    expect(styles).toContain('textarea, [data-slot="textarea"]');
    expect(styles).toContain("overflow-wrap: anywhere");
  });
});
