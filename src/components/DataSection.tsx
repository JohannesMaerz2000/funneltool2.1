/** Renders an arbitrary Record<string, unknown> as a key-value table. */
export default function DataSection({
  title,
  data,
}: {
  title: string;
  data?: Record<string, unknown>;
}) {
  if (!data || Object.keys(data).length === 0) return null;

  const rows = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
        {title}
      </h3>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {rows.map(([key, value]) => (
              <tr key={key} className="even:bg-emerald-50/30">
                <td className="w-1/3 whitespace-nowrap px-3 py-2 font-medium text-gray-600">
                  {key}
                </td>
                <td className="break-all px-3 py-2 text-gray-800">
                  {typeof value === "object"
                    ? <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(value, null, 2)}</pre>
                    : String(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
