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

/** Wraps at spaces, keeps explicit newlines and splits by character, without hyphens, only a word longer than the line; never truncates. */
export function fitLabelWords(text: string, width: number, measure: (text: string) => number): string[] | null {
  const output: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ").filter(Boolean);
    if (!words.length) return null;
    let line = "";
    for (const word of words) {
      if (measure(word) <= width) {
        if (line && measure(`${line} ${word}`) <= width) line += ` ${word}`;
        else {
          if (line) output.push(line);
          line = word;
        }
        continue;
      }
      if (line) output.push(line);
      line = "";
      for (const character of Array.from(word)) {
        if (measure(character) > width) return null;
        if (measure(line + character) > width) {
          output.push(line);
          line = character;
        } else line += character;
      }
    }
    output.push(line);
  }
  return output;
}
