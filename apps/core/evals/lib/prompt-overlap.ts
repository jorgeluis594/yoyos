import ts from "typescript";

/**
 * Finds production prompt examples that copy or closely paraphrase an eval input (docs/message-to-order.md: prompt examples never copy
 * eval inputs). An example is a «…» quote or an item of a parenthesised list inside a string literal of a file whose text reaches a
 * model; comments are never sent to a model and are not read.
 */

export type PromptExample = Readonly<{ file: string; line: number; text: string }>;
export type Overlap = Readonly<{ example: PromptExample; input: string; reason: string }>;

/** Shared word n-grams this long are a copy when they hold two content words. */
const NGRAM = 3;
/** Character similarity at or above which an example is a near copy of the input or of a run of its words. */
const MIN_SIMILARITY = 0.8;

const numberWords = new Set(["un", "una", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"]);
/** Words that carry no wording of their own: a rule template («a N soles», «N de cada uno») shares them by design. */
const functionWords = new Set(["a", "al", "de", "del", "el", "la", "lo", "las", "los", "en", "y", "o", "que", "por", "con", "para", "me", "te", "se", "mi", "su", "#"]);

/** Lowercase, no accents, numbers and number words as «#», punctuation as spaces. */
export const normalizeText = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  .replace(/\d+([.,]\d+)?/g, "#").replace(/[^\p{L}#]+/gu, " ").split(" ").filter(Boolean).map((word) => numberWords.has(word) ? "#" : word).join(" ");
const wordsOf = (text: string) => normalizeText(text).split(" ").filter(Boolean);
const contentWords = (words: readonly string[]) => words.filter((word) => word.length > 1 && !functionWords.has(word)).length;

function stringLiterals(source: string, fileName: string): readonly Readonly<{ text: string; line: number }>[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const literals: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      literals.push({ text: node.text, line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return literals;
}

/** The «…» quotes and the items of parenthesised lists in the string literals of one source file. */
export function examplesOf(source: string, fileName: string): readonly PromptExample[] {
  return stringLiterals(source, fileName).flatMap(({ text, line }) => {
    const quoted = [...text.matchAll(/«([^»]+)»/g)].map((match) => match[1]!);
    const listed = [...text.replace(/«[^»]*»/g, "").matchAll(/\(([^()]+)\)/g)].flatMap((match) => match[1]!.split(/,|;/));
    return [...quoted, ...listed].map((example) => example.trim()).filter((example) => wordsOf(example).length > 0)
      .map((example) => ({ file: fileName, line, text: example }));
  });
}

const ngrams = (words: readonly string[], size: number): readonly (readonly string[])[] =>
  words.length < size ? [] : words.slice(0, words.length - size + 1).map((_, index) => words.slice(index, index + size));

function similarity(left: string, right: string): number {
  if (!left.length && !right.length) return 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = current;
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length);
}

/**
 * Why an example copies an eval input, or null. Numbers count as one word, so another number is no new wording. A copy is the same
 * words; or, when the example has two content words (not articles, prepositions or numbers), the example inside the input, a shared
 * run of three words holding two content words, or, for three words or more, a similarity of 0.8 with the input or with a run of its words
 * as long as the example.
 */
export function overlapReason(example: string, input: string): string | null {
  const exampleWords = wordsOf(example);
  const inputWords = wordsOf(input);
  const left = exampleWords.join(" ");
  if (left === inputWords.join(" ")) return "same words";
  if (contentWords(exampleWords) < 2) return null;
  if (` ${inputWords.join(" ")} `.includes(` ${left} `)) return "example inside the input";
  const inputGrams = new Set(ngrams(inputWords, NGRAM).filter((gram) => contentWords(gram) >= 2).map((gram) => gram.join(" ")));
  const shared = ngrams(exampleWords, NGRAM).map((gram) => gram.join(" ")).find((gram) => inputGrams.has(gram));
  if (shared) return `shares «${shared}»`;
  // Two-word examples differ from a value by one letter («talla XS», «talla XL»): only longer ones are compared by similarity.
  if (exampleWords.length < 3) return null;
  const windows = [inputWords, ...ngrams(inputWords, exampleWords.length)].filter((words) => contentWords(words) >= 2);
  const score = Math.max(0, ...windows.map((words) => similarity(left, words.join(" "))));
  return score >= MIN_SIMILARITY ? `similarity ${score.toFixed(2)}` : null;
}

export function findOverlaps(examples: readonly PromptExample[], inputs: readonly string[]): readonly Overlap[] {
  return examples.flatMap((example) => inputs.flatMap((input) => {
    const reason = overlapReason(example.text, input);
    return reason ? [{ example, input, reason }] : [];
  }));
}
