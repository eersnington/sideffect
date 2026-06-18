import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

import { CONTENT_WIDTH } from "./constants";
import { ds } from "./design";
import type { CodeSnippet } from "./snippets";
import { visibleChars } from "./typewriter";
import { CodeWindow } from "./components/CodeWindow";
import { InstallBadge } from "./components/InstallBadge";
import { TypingInstallTerminal } from "./components/TypingInstallTerminal";

type CodeSceneProps = {
  readonly snippet: CodeSnippet;
};

const revealStyle = (frame: number, start: number): CSSProperties => {
  const opacity = interpolate(frame, [start, start + 18], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, [start, start + 18], [24, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [start, start + 18], [0.985, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return {
    opacity,
    transform: `translateY(${y}px) scale(${scale})`,
  };
};

export const IntroScene = () => (
  <AbsoluteFill
    style={{
      alignItems: "center",
      display: "flex",
      justifyContent: "center",
    }}
  >
    <TypingInstallTerminal />
  </AbsoluteFill>
);

export const CodeScene = ({ snippet }: CodeSceneProps) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        display: "flex",
        fontFamily: ds.fontBody,
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <CodeWindow
        charBudget={visibleChars(frame)}
        filename={snippet.filename}
        fontSize={snippet.fontSize}
        highlightLines={snippet.highlightLines}
        lineHeight={snippet.lineHeight}
        lines={snippet.lines}
        width={snippet.width ?? CONTENT_WIDTH}
      />
    </AbsoluteFill>
  );
};

export const FinalScene = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        fontFamily: ds.fontBody,
        justifyContent: "center",
        paddingBottom: 18,
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: ds.finalText,
          fontFamily: ds.fontBody,
          fontSize: 138,
          fontWeight: 500,
          letterSpacing: 0,
          lineHeight: 0.9,
          textShadow: ds.finalShadow,
          ...revealStyle(frame, 8),
        }}
      >
        sideffect
      </div>
      <div
        style={{
          color: "rgba(248, 250, 252, 0.92)",
          fontFamily: ds.fontBody,
          fontSize: 33,
          fontWeight: 500,
          lineHeight: 1.24,
          marginTop: 48,
          maxWidth: 1120,
          textShadow: ds.finalShadow,
          ...revealStyle(frame, 38),
        }}
      >
        <span style={{ display: "block" }}>Build composable Cloudflare Workflows,</span>
        <span style={{ display: "block" }}>and generate bindings automatically with Vite</span>
      </div>
      <div style={{ marginTop: 54, ...revealStyle(frame, 68) }}>
        <InstallBadge scale={1} />
      </div>
    </AbsoluteFill>
  );
};
