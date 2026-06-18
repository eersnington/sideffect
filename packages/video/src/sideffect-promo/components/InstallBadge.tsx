import { INSTALL_COMMAND } from "../constants";
import { ds } from "../design";
import { CopyIcon } from "./CopyIcon";

type InstallBadgeProps = {
  readonly scale?: number;
  readonly showCopy?: boolean;
};

export const InstallBadge = ({ scale = 1, showCopy = true }: InstallBadgeProps) => (
  <div
    style={{
      alignItems: "center",
      background: "rgba(255, 255, 255, 0.92)",
      border: "2px solid rgba(15, 23, 42, 0.12)",
      borderRadius: 18 * scale,
      boxShadow: "0 18px 60px rgba(15, 23, 42, 0.16)",
      color: "rgba(15, 23, 42, 0.92)",
      display: "flex",
      fontFamily: ds.fontMono,
      fontSize: 25 * scale,
      fontWeight: 500,
      height: 78 * scale,
      overflow: "hidden",
      width: 514 * scale,
    }}
  >
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flex: 1,
        height: "100%",
        padding: `0 ${32 * scale}px`,
        whiteSpace: "pre",
      }}
    >
      {INSTALL_COMMAND}
    </div>
    {showCopy ? (
      <div
        style={{
          alignItems: "center",
          borderLeft: "2px solid rgba(15, 23, 42, 0.1)",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: 86 * scale,
        }}
      >
        <CopyIcon bg="rgba(255, 255, 255, 0.92)" color="rgba(15, 23, 42, 0.72)" size={24 * scale} />
      </div>
    ) : null}
  </div>
);
