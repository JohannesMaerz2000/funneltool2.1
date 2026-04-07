/** Renders an arbitrary Record<string, unknown> as a key-value table. */
export default function DataSection({
  title,
  data,
  excludeKeys = [],
}: {
  title: string;
  data?: Record<string, unknown>;
  excludeKeys?: string[];
}) {
  if (!data || Object.keys(data).length === 0) return null;

  const excluded = new Set(excludeKeys);
  const rows: Array<{ key: string; value: string }> = [];

  const pushRow = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    rows.push({ key, value: String(value) });
  };

  const flatten = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        rows.push({ key, value: "[]" });
        return;
      }
      value.forEach((item, index) => flatten(`${key}[${index}]`, item));
      return;
    }

    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, nested]) => nested !== null && nested !== undefined && nested !== ""
      );
      if (entries.length === 0) {
        rows.push({ key, value: "{}" });
        return;
      }
      entries.forEach(([nestedKey, nestedValue]) => flatten(`${key}.${nestedKey}`, nestedValue));
      return;
    }

    pushRow(key, value);
  };

  Object.entries(data)
    .filter(([key]) => !excluded.has(key))
    .forEach(([key, value]) => flatten(key, value));

  if (rows.length === 0) return null;

  return (
    <div>
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300 border-b border-slate-700 pb-3">
        {title}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800/50 shadow-lg">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-slate-700">
            {rows.map((row, idx) => (
              <tr key={row.key} className={idx % 2 === 0 ? "bg-slate-800/30" : "bg-slate-800/50"}>
                <td className="w-1/3 whitespace-nowrap px-4 py-3 font-semibold text-slate-300">
                  {row.key}
                </td>
                <td className="break-all px-4 py-3 text-slate-100">
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
