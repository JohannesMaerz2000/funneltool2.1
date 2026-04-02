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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
        {title}
      </h3>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.key} className="even:bg-emerald-50/30">
                <td className="w-1/3 whitespace-nowrap px-3 py-2 font-medium text-gray-600">
                  {row.key}
                </td>
                <td className="break-all px-3 py-2 text-gray-800">
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
