import { Routes, Route, Navigate } from "react-router-dom";
import SubmissionList from "./pages/SubmissionList";
import SubmissionDetail from "./pages/SubmissionDetail";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-full items-center gap-4 px-6 py-5">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-lg font-bold text-white shadow-lg">
            F
          </span>
          <div>
            <span className="text-2xl font-bold tracking-tight text-white">Funnel Tool</span>
            <span className="ml-3 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-400 border border-slate-700">
              Internal
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/submissions" replace />} />
          <Route path="/submissions" element={<SubmissionList />} />
          <Route path="/submissions/:id" element={<SubmissionDetail />} />
        </Routes>
      </main>
    </div>
  );
}
