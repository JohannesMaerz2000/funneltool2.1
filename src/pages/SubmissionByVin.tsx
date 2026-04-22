import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { resolveSubmissionByVin } from "../api/client";
import SubmissionDetail from "./SubmissionDetail";
import type { PrefetchedCaseContext } from "../types/submission";

type SubmissionByVinLocationState = {
  prefetchedCase?: PrefetchedCaseContext;
};

export default function SubmissionByVin() {
  const { vin } = useParams<{ vin: string }>();
  const location = useLocation();
  const backToList = `/submissions${location.search}`;

  const normalizedVin = vin?.toUpperCase();
  const state = location.state as SubmissionByVinLocationState | null;
  const prefetchedCase = state?.prefetchedCase;
  const prefetchedOpenId =
    prefetchedCase &&
    (!normalizedVin || !prefetchedCase.vin || prefetchedCase.vin.toUpperCase() === normalizedVin)
      ? prefetchedCase.openId
      : null;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["resolve-vin", normalizedVin],
    queryFn: () => resolveSubmissionByVin(normalizedVin!),
    enabled: !!normalizedVin && !prefetchedOpenId,
    staleTime: 60_000,
  });

  if (prefetchedOpenId) {
    return <SubmissionDetail submissionId={prefetchedOpenId} />;
  }

  if (isLoading) {
    return <div className="py-10 text-zinc-400">Lade Fall...</div>;
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <Link to={backToList} className="text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors">
          ← Zurück zur Liste
        </Link>
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
          <strong className="block text-rose-900 mb-1">VIN nicht gefunden</strong>
          {error instanceof Error ? error.message : `Kein Fall für VIN ${normalizedVin ?? ""} gefunden`}
        </div>
      </div>
    );
  }

  return <SubmissionDetail submissionId={data.id} />;
}
