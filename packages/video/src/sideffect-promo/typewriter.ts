import { CODE_CHARS_PER_SECOND, FPS, TYPE_START } from "./constants";

export const visibleChars = (frame: number, delay = TYPE_START, cps = CODE_CHARS_PER_SECOND) =>
  Math.floor((Math.max(0, frame - delay) / FPS) * cps);
