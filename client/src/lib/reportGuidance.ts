export const reportPromptFields = [
  { key: "mood", label: "Mood", prompt: "How did the young person present? Record observable words or behaviour rather than an assumption." },
  { key: "attitude", label: "Attitude and engagement", prompt: "What was their level of engagement, and what factual examples support this?" },
  { key: "learning", label: "Learning and progress", prompt: "What did they learn, practise, attend or achieve? Include their own view where relevant." },
  { key: "enthusiasm", label: "Enthusiasm and motivation", prompt: "What showed interest, motivation or a barrier to participation?" },
  { key: "discussions", label: "Discussion and direct work", prompt: "What happened, who was present, the young person's view, and any agreed outcome." },
  { key: "pointsToNote", label: "Points for the next shift", prompt: "Record only relevant changes, appointments, risks, achievements or information the next worker needs." },
  { key: "plan", label: "Plan and actions", prompt: "State the next action, owner and time frame." },
] as const;

export type ReportPromptKey = typeof reportPromptFields[number]["key"];

export function dictationUnavailableMessage() {
  return "Dictation is not available in this browser. Type the note instead, or use a browser with speech input enabled.";
}
