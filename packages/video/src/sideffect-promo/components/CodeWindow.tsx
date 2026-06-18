import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";

import {
  CODE_BODY_PADDING_BOTTOM,
  CODE_BODY_PADDING_TOP,
  CODE_BODY_PADDING_X,
  CODE_HEADER_HEIGHT,
  CODE_LINE_HEIGHT,
  CODE_ROW_PADDING_LEFT,
  CODE_ROW_PADDING_RIGHT,
  CODE_VERTICAL_PADDING,
  CONTENT_WIDTH,
} from "../constants";
import { ds } from "../design";
import { syntaxColors, tokenizeLine } from "../syntax";
import { totalChars } from "../timings";

type CodeWindowProps = {
  readonly charBudget: number;
  readonly filename: string;
  readonly fontSize?: number;
  readonly highlightLines?: readonly number[];
  readonly lineHeight?: number;
  readonly lines: readonly string[];
  readonly style?: CSSProperties;
  readonly width?: number;
};

const codeBodyHeight = (lineCount: number, lineHeight = CODE_LINE_HEIGHT) =>
  CODE_VERTICAL_PADDING + lineCount * lineHeight;

const codeWindowHeight = (lineCount: number, lineHeight = CODE_LINE_HEIGHT) =>
  CODE_HEADER_HEIGHT + codeBodyHeight(lineCount, lineHeight);

const currentTypedLine = (lines: readonly string[], charBudget: number) => {
  let consumed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    consumed += lines[index].length + 1;
    if (charBudget < consumed) {
      return index + 1;
    }
  }

  return lines.length;
};

const lineHasTyped = (lines: readonly string[], lineNumber: number, charBudget: number) => {
  const charsBeforeLine = lines
    .slice(0, lineNumber - 1)
    .reduce((sum, line) => sum + line.length + 1, 0);

  return charBudget > charsBeforeLine;
};

export const CodeWindow = ({
  charBudget,
  filename,
  fontSize = 24,
  highlightLines = [],
  lineHeight = CODE_LINE_HEIGHT,
  lines,
  style,
  width = CONTENT_WIDTH,
}: CodeWindowProps) => {
  let remaining = charBudget;
  const frame = useCurrentFrame();
  const typedLine = currentTypedLine(lines, charBudget);
  const cursorOn = Math.floor(frame / 15) % 2 === 0;
  const bodyHeight = codeBodyHeight(lines.length, lineHeight);
  const windowHeight = codeWindowHeight(lines.length, lineHeight);
  const fullBudget = totalChars(lines);

  return (
    <div
      style={{
        background: ds.codeBg,
        border: `1px solid ${ds.border}`,
        borderRadius: 8,
        boxShadow: "0 28px 90px rgba(31, 45, 62, 0.22)",
        height: windowHeight,
        overflow: "hidden",
        width,
        ...style,
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: ds.codeHeader,
          borderBottom: `1px solid ${ds.borderStrong}`,
          color: ds.codeMeta,
          display: "flex",
          fontFamily: ds.fontMono,
          fontSize: 20,
          fontWeight: 700,
          height: CODE_HEADER_HEIGHT,
          padding: "0 26px",
        }}
      >
        <span>{filename}</span>
      </div>
      <div
        style={{
          boxSizing: "border-box",
          fontFamily: ds.fontMono,
          fontSize,
          fontVariantLigatures: "none",
          height: bodyHeight,
          lineHeight: 1,
          padding: `${CODE_BODY_PADDING_TOP}px ${CODE_BODY_PADDING_X}px ${CODE_BODY_PADDING_BOTTOM}px`,
          position: "relative",
        }}
      >
        {highlightLines.map((lineNumber) => {
          const hasTyped = lineHasTyped(lines, lineNumber, charBudget);

          return (
            <div
              key={`${filename}-highlight-${lineNumber}`}
              style={{
                background: ds.codeHighlight,
                boxSizing: "border-box",
                height: lineHeight,
                left: 0,
                opacity: hasTyped ? 1 : 0,
                pointerEvents: "none",
                position: "absolute",
                right: 0,
                top: CODE_BODY_PADDING_TOP + (lineNumber - 1) * lineHeight,
              }}
            />
          );
        })}
        {lines.map((line, index) => {
          const visible = line.slice(0, Math.max(0, remaining));
          const lineNumber = index + 1;
          const hasTyped = visible.length > 0 || remaining > 0;
          const isCurrentLine = typedLine === lineNumber && charBudget < fullBudget;
          remaining -= line.length + 1;

          return (
            <div
              key={`${filename}-${lineNumber}`}
              style={{
                alignItems: "center",
                boxSizing: "border-box",
                display: "flex",
                height: lineHeight,
                opacity: hasTyped ? 1 : 0.18,
                overflow: "hidden",
                paddingLeft: CODE_ROW_PADDING_LEFT,
                paddingRight: CODE_ROW_PADDING_RIGHT,
                position: "relative",
                whiteSpace: "pre",
              }}
            >
              <span
                style={{
                  alignItems: "center",
                  color: ds.codeLine,
                  display: "flex",
                  flex: "0 0 54px",
                  height: "100%",
                  justifyContent: "flex-end",
                  lineHeight: 1,
                  marginRight: 28,
                  textAlign: "right",
                }}
              >
                {lineNumber.toString().padStart(2, "0")}
              </span>
              <span
                style={{
                  alignItems: "center",
                  display: "flex",
                  height: "100%",
                  lineHeight: 1,
                  minWidth: 0,
                  position: "relative",
                  whiteSpace: "pre",
                }}
              >
                {line.startsWith("  ") ? (
                  <span
                    style={{
                      background: ds.codeIndent,
                      display: "inline-block",
                      height: lineHeight,
                      left: 0,
                      position: "absolute",
                      top: 0,
                      width: 1,
                    }}
                  />
                ) : null}
                {tokenizeLine(visible).map(([text, kind], tokenIndex) => (
                  <span
                    key={`${lineNumber}-${tokenIndex}`}
                    style={{
                      color: syntaxColors[kind],
                      display: "inline-block",
                      lineHeight: 1,
                      whiteSpace: "pre",
                    }}
                  >
                    {text}
                  </span>
                ))}
                {isCurrentLine ? (
                  <span
                    style={{
                      alignSelf: "center",
                      background: cursorOn ? ds.accent : "transparent",
                      display: "inline-block",
                      flex: "0 0 auto",
                      height: Math.min(lineHeight - 8, fontSize + 7),
                      marginLeft: 3,
                      width: 9,
                    }}
                  />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
