import { Routes, Route, Navigate } from "react-router-dom";
import SubmissionList from "./pages/SubmissionList";
import SubmissionDetail from "./pages/SubmissionDetail";
import { ui } from "./components/ui";

export default function App() {
  return (
    <div className={ui.page}>
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-full items-center gap-4 px-6 py-5">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sky-900/50 bg-gradient-to-br from-zinc-800 to-sky-950/40 text-lg font-bold text-zinc-100">
            F
          </span>
          <div>
            <span className="text-2xl font-semibold tracking-tight text-zinc-100">Funnel Tool</span>
            <span className="ml-3 rounded-full border border-emerald-900/50 bg-emerald-950/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-200">
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
