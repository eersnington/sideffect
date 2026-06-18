import { useCurrentFrame } from "remotion";

import { INSTALL_COMMAND } from "../constants";
import { ds } from "../design";
import { visibleChars } from "../typewriter";

const TerminalDot = ({ color }: { readonly color: string }) => (
  <span
    style={{
      background: color,
      borderRadius: 999,
      display: "block",
      height: 12,
      width: 12,
    }}
  />
);

export const TypingInstallTerminal = () => {
  const frame = useCurrentFrame();
  const commandBudget = visibleChars(frame, 14, 18);
  const typed = INSTALL_COMMAND.slice(0, Math.min(INSTALL_COMMAND.length, commandBudget));
  const commandComplete = typed.length >= INSTALL_COMMAND.length;
  const cursorOn = !commandComplete && Math.floor(frame / 12) % 2 === 0;

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.92)",
        border: "1px solid rgba(15, 23, 42, 0.16)",
        borderRadius: 18,
        boxShadow: "0 30px 88px rgba(15, 23, 42, 0.22)",
        color: "rgba(15, 23, 42, 0.94)",
        fontFamily: ds.fontMono,
        height: 158,
        overflow: "hidden",
        width: 760,
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: "1px solid rgba(15, 23, 42, 0.12)",
          display: "flex",
          gap: 9,
          height: 48,
          padding: "0 22px",
        }}
      >
        <TerminalDot color="#ff5f57" />
        <TerminalDot color="#ffbd2e" />
        <TerminalDot color="#28c840" />
        <span
          style={{
            color: "rgba(15, 23, 42, 0.42)",
            flex: 1,
            fontFamily: ds.fontBody,
            fontSize: 15,
            fontWeight: 500,
            textAlign: "center",
            transform: "translateX(-31px)",
          }}
        >
          terminal
        </span>
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 500,
          lineHeight: 1,
          padding: "35px 34px 0",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            height: 40,
          }}
        >
          <span style={{ color: "rgba(22, 101, 52, 0.9)", marginRight: 18 }}>$</span>
          <span style={{ display: "inline-block" }}>{typed}</span>
          <span
            style={{
              alignSelf: "center",
              background: cursorOn ? ds.accent : "transparent",
              display: "inline-block",
              flex: "0 0 auto",
              height: 32,
              marginLeft: 4,
              width: 9,
            }}
          />
        </div>
      </div>
    </div>
  );
};
