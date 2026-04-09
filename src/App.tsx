import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import SubmissionList from "./pages/SubmissionList";
import SubmissionDetail from "./pages/SubmissionDetail";
import Login from "./pages/Login";
import { ui } from "./components/ui";
import { onUnauthorized } from "./api/client";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if we already have a valid session
    fetch("/api/health").then((r) => {
      // health is public, so check a protected endpoint instead
      fetch("/api/submissions?pageSize=1").then((r2) => {
        setAuthed(r2.ok);
      });
    });
  }, []);

  useEffect(() => {
    return onUnauthorized(() => setAuthed(false));
  }, []);

  if (authed === null) return null; // loading

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className={ui.page}>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-full items-center gap-4 px-6 py-5">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#3ec099]/30 bg-white text-lg font-bold text-[#3ec099] shadow-sm">
            F
          </span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 text-2xl font-bold tracking-tight text-zinc-900">
              Featherless
              <span className="flex items-center gap-1">
                <span className="text-xl">🪶</span>
                <span className="text-xl">🚫</span>
              </span>
            </span>
            <div id="header-portal-root" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-6 pt-6 pb-8">
        <Routes>
          <Route path="/" element={<Navigate to="/submissions" replace />} />
          <Route path="/submissions" element={<SubmissionList />} />
          <Route path="/submissions/:id" element={<SubmissionDetail />} />
        </Routes>
      </main>
    </div>
  );
}
