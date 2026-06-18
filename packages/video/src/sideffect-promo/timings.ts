import { CODE_CHARS_PER_SECOND, FPS, TYPE_START } from "./constants";
import { CODE_SNIPPETS, type CodeSnippet } from "./snippets";

export const totalChars = (lines: readonly string[]) =>
  lines.reduce((sum, line) => sum + line.length + 1, 0);

const codeSceneDuration = (lines: readonly string[], dwell: number, cps = CODE_CHARS_PER_SECOND) =>
  TYPE_START + Math.ceil((totalChars(lines) / cps) * FPS) + dwell;

export const INTRO_DURATION = 110;
export const FINAL_DURATION = 130;

let nextFrom = INTRO_DURATION;

export const CODE_SEQUENCE_TIMINGS = CODE_SNIPPETS.map((snippet) => {
  const durationInFrames = codeSceneDuration(snippet.lines, snippet.dwell);
  const from = nextFrom;
  nextFrom += durationInFrames;

  return { durationInFrames, from, snippet };
}) satisfies Array<{
  readonly durationInFrames: number;
  readonly from: number;
  readonly snippet: CodeSnippet;
}>;

export const FINAL_FROM = nextFrom;
export const SIDEFFECT_PROMO_DURATION = FINAL_FROM + FINAL_DURATION;
