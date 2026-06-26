import { recommendedRules, strictRules } from "./configs.ts";
import { basePlugin, type SideffectLintPlugin } from "./plugin.ts";

type SideffectFlatConfig = {
  readonly plugins: { readonly sideffect: SideffectLintPlugin };
  readonly rules: typeof recommendedRules | typeof strictRules;
};

type SideffectESLintPlugin = SideffectLintPlugin & {
  readonly configs: {
    readonly recommended: ReadonlyArray<SideffectFlatConfig>;
    readonly strict: ReadonlyArray<SideffectFlatConfig>;
  };
};

const eslintPlugin: SideffectESLintPlugin = {
  ...basePlugin,
  configs: {
    get recommended() {
      return eslintRecommended;
    },
    get strict() {
      return eslintStrict;
    },
  },
};

export const eslintRecommended = [
  {
    plugins: { sideffect: eslintPlugin },
    rules: recommendedRules,
  },
];

export const eslintStrict = [
  {
    plugins: { sideffect: eslintPlugin },
    rules: strictRules,
  },
];

export default eslintPlugin;
export { rules } from "./plugin.ts";
