import { ds } from "../design";

type CopyIconProps = {
  readonly bg?: string;
  readonly color?: string;
  readonly size?: number;
};

export const CopyIcon = ({ bg = ds.badgeBg, color = ds.codeMeta, size = 20 }: CopyIconProps) => (
  <span
    style={{
      display: "inline-block",
      height: size,
      position: "relative",
      width: size,
    }}
  >
    <span
      style={{
        border: `2px solid ${color}`,
        borderRadius: 4,
        height: size * 0.62,
        left: size * 0.3,
        opacity: 0.74,
        position: "absolute",
        top: size * 0.12,
        width: size * 0.62,
      }}
    />
    <span
      style={{
        background: bg,
        border: `2px solid ${color}`,
        borderRadius: 4,
        height: size * 0.62,
        left: size * 0.08,
        position: "absolute",
        top: size * 0.32,
        width: size * 0.62,
      }}
    />
  </span>
);
