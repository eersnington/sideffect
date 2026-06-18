import { AbsoluteFill, Sequence } from "remotion";

import { Background } from "./components/Background";
import { SceneTransition } from "./components/SceneTransition";
import { CODE_SEQUENCE_TIMINGS, FINAL_DURATION, FINAL_FROM, INTRO_DURATION } from "./timings";
import { CodeScene, FinalScene, IntroScene } from "./scenes";

export { SIDEFFECT_PROMO_DURATION } from "./timings";

export const SideffectPromo = () => (
  <AbsoluteFill>
    <Background />
    <Sequence durationInFrames={INTRO_DURATION} from={0} layout="none">
      <SceneTransition durationInFrames={INTRO_DURATION}>
        <IntroScene />
      </SceneTransition>
    </Sequence>
    {CODE_SEQUENCE_TIMINGS.map(({ durationInFrames, from, snippet }) => (
      <Sequence durationInFrames={durationInFrames} from={from} key={snippet.id} layout="none">
        <SceneTransition durationInFrames={durationInFrames}>
          <CodeScene snippet={snippet} />
        </SceneTransition>
      </Sequence>
    ))}
    <Sequence durationInFrames={FINAL_DURATION} from={FINAL_FROM} layout="none">
      <SceneTransition durationInFrames={FINAL_DURATION} fadeOut={false}>
        <FinalScene />
      </SceneTransition>
    </Sequence>
  </AbsoluteFill>
);
