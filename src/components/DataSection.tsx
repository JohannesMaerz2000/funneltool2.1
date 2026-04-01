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
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
        {title}
      </h3>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {rows.map(([key, value]) => (
              <tr key={key} className="even:bg-gray-50">
                <td className="px-3 py-1.5 font-medium text-gray-600 whitespace-nowrap w-1/3">
                  {key}
                </td>
                <td className="px-3 py-1.5 text-gray-800 break-all">
                  {typeof value === "object"
                    ? <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
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
