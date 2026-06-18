import { AbsoluteFill, Img, staticFile } from "remotion";

export const Background = () => (
  <AbsoluteFill style={{ background: "#08111f", overflow: "hidden" }}>
    <Img
      src={staticFile("background.png")}
      style={{
        height: "100%",
        objectFit: "cover",
        objectPosition: "center",
        width: "100%",
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0) 44%), linear-gradient(180deg, rgba(8, 17, 31, 0.08) 0%, rgba(8, 17, 31, 0.34) 100%)",
      }}
    />
  </AbsoluteFill>
);
