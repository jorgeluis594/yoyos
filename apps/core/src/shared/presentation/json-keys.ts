export function hasDuplicateJsonKeys(raw: string): boolean {
  const stack: ({ kind: "object"; keys: Set<string>; expectsKey: boolean } | { kind: "array" })[] = [];
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      const start = index;
      while (++index < raw.length) {
        if (raw[index] === "\\") { index++; continue; }
        if (raw[index] === '"') break;
      }
      const top = stack.at(-1);
      if (top?.kind === "object" && top.expectsKey) {
        const key = JSON.parse(raw.slice(start, index + 1)) as string;
        if (top.keys.has(key)) return true;
        top.keys.add(key);
        top.expectsKey = false;
      }
    } else if (char === "{") stack.push({ kind: "object", keys: new Set(), expectsKey: true });
    else if (char === "[") stack.push({ kind: "array" });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") {
      const top = stack.at(-1);
      if (top?.kind === "object") top.expectsKey = true;
    }
  }
  return false;
}
