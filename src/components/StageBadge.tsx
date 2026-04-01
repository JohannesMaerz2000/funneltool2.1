import type { Stage } from "../types/submission";

const colours: Record<Stage, string> = {
  M1: "bg-blue-100 text-blue-800",
  "M1.5": "bg-purple-100 text-purple-800",
  unknown: "bg-gray-100 text-gray-500",
};

export default function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded ${colours[stage]}`}>{stage}</span>
  );
}
