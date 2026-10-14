/** Keys of a schedule's rate table (dimension values joined by "|"), in the order the database enumerates them. */
export function scheduleKeys(dims: string[], options: Record<string, { values: (string | number)[] }>): { key: string; options: Record<string, string | number> }[] {
  let set: Record<string, string | number>[] = [{}];
  for (const d of dims) {
    const values = options[d]?.values;
    if (!values) return [];
    set = set.flatMap((c) => values.map((v) => ({ ...c, [d]: v })));
  }
  return set.map((o) => ({ key: dims.map((d) => String(o[d])).join("|"), options: o }));
}
