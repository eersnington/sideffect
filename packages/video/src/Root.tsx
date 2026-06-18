import "./index.css";
import { Composition } from "remotion";
import { SideffectPromo, SIDEFFECT_PROMO_DURATION } from "./sideffect-promo/composition";

export { SideffectPromo, SIDEFFECT_PROMO_DURATION };

export const RemotionRoot: React.FC = () => (
  <Composition
    component={SideffectPromo}
    durationInFrames={SIDEFFECT_PROMO_DURATION}
    fps={30}
    height={1080}
    id="SideffectPromo"
    width={1920}
  />
);
