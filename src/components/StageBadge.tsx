import type { Stage } from "../types/submission";

const colours: Record<Stage, string> = {
  M1: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90",
  "M1.5": "bg-teal-100 text-teal-800 ring-1 ring-teal-200/90",
  unknown: "bg-gray-100 text-gray-600 ring-1 ring-gray-200/90",
};

export default function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${colours[stage]}`}>
      {stage}
    </span>
  );
}
