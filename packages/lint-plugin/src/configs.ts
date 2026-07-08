export const recommendedRules = {
  "sideffect/await-step-calls": "error",
  "sideffect/no-event-mutation": "error",
  "sideffect/no-step-race-any-outside-step": "warn",
} as const;

export const strictRules = {
  ...recommendedRules,
  "sideffect/deterministic-step-names": "warn",
  "sideffect/max-step-timeout-30m": "error",
} as const;

export const oxlintRecommended = {
  jsPlugins: [{ name: "sideffect", specifier: "@sideffect/lint/oxlint" }],
  rules: recommendedRules,
};

export const oxlintStrict = {
  jsPlugins: [{ name: "sideffect", specifier: "@sideffect/lint/oxlint" }],
  rules: strictRules,
};
