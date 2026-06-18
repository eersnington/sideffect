import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

import { TRANSITION_DURATION } from "../constants";

type SceneTransitionProps = {
  readonly children: ReactNode;
  readonly durationInFrames: number;
  readonly fadeIn?: boolean;
  readonly fadeOut?: boolean;
};

export const SceneTransition = ({
  children,
  durationInFrames,
  fadeIn = true,
  fadeOut = true,
}: SceneTransitionProps) => {
  const frame = useCurrentFrame();
  const enterOpacity = fadeIn
    ? interpolate(frame, [0, TRANSITION_DURATION], [0, 1], {
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const exitOpacity = fadeOut
    ? interpolate(frame, [durationInFrames - TRANSITION_DURATION, durationInFrames], [1, 0], {
        easing: Easing.bezier(0.4, 0, 1, 1),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  return (
    <AbsoluteFill style={{ opacity: Math.min(enterOpacity, exitOpacity) }}>{children}</AbsoluteFill>
  );
};
