export function fitLabelLines(text: string, width: number, measure: (text: string) => number, maximum: number, truncate: boolean): string[] | null {
  const output: string[] = [];
  let line = "";
  for (const character of Array.from(text)) {
    if (measure(character) > width) return null;
    if (character === "\n" || measure(line + character) > width) {
      if (!line) return null;
      output.push(line);
      line = character === "\n" ? "" : character;
    } else line += character;
    if (output.length === maximum) {
      if (!truncate) return null;
      if (measure("…") > width) return null;
      const last = output.pop() ?? "";
      let shortened = last;
      while (shortened && measure(shortened + "…") > width) shortened = Array.from(shortened).slice(0, -1).join("");
      output.push(shortened + "…");
      return output;
    }
  }
  if (line) output.push(line);
  return output.length <= maximum ? output : null;
}
