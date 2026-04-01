import { Routes, Route, Navigate } from "react-router-dom";
import SubmissionList from "./pages/SubmissionList";
import SubmissionDetail from "./pages/SubmissionDetail";

export default function App() {
  return (
    <div className="min-h-screen text-gray-900">
      <header className="sticky top-0 z-20 border-b border-emerald-100/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-sm font-bold text-emerald-700">
            F
          </span>
          <span className="text-xl font-semibold tracking-tight">Funnel Tool</span>
          <span className="ml-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Internal
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/submissions" replace />} />
          <Route path="/submissions" element={<SubmissionList />} />
          <Route path="/submissions/:id" element={<SubmissionDetail />} />
        </Routes>
      </main>
    </div>
  );
}
