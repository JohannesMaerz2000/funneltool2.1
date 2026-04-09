import { useState, type FormEvent } from "react";
import { ui } from "../components/ui";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const password = form.get("password") as string;

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Wrong password");
        return;
      }
      onSuccess();
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`${ui.page} flex items-center justify-center`}>
      <form
        onSubmit={handleSubmit}
        className={`${ui.card} w-full max-w-sm p-8 shadow-2xl`}
      >
        <div className="mb-8 text-center">
          <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[#3ec099]/30 bg-white text-xl font-bold text-[#3ec099] shadow-sm">
            F
          </span>
          <h1 className="text-2xl font-bold text-zinc-900">
            Welcome Back
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Enter your password to access Featherless
          </p>
        </div>

        {/* Hidden username field so browsers offer to save credentials */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          defaultValue="admin"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        <div className="space-y-4">
          <div>
            <label className={ui.eyebrow} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              className={`${ui.input} w-full`}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm font-medium text-rose-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`${ui.button} w-full`}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
