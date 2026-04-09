import { useState, type FormEvent } from "react";

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
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl"
      >
        <h1 className="mb-6 text-center text-xl font-semibold text-zinc-100">
          Featherless Login
        </h1>

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

        <label className="mb-2 block text-sm text-zinc-400" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-sky-600 focus:ring-1 focus:ring-sky-600"
          placeholder="Enter password"
        />

        {error && (
          <p className="mb-3 text-sm text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? "..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
