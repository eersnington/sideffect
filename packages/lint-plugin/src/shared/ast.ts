import type { Node, RuleContext, WorkflowContextInfo } from "../types.ts";

export const stepMethodNames = new Set(["do", "sleep", "sleepUntil", "waitForEvent"]);

export interface ImportAliases {
  readonly workflowEntrypoint: Set<string>;
  readonly workflow: Set<string>;
  readonly step: Set<string>;
  readonly sideffectNamespaces: Set<string>;
  readonly cloudflareNamespaces: Set<string>;
}

export interface ProgramState {
  readonly imports: ImportAliases;
  readonly workflowDefinitions: Set<string>;
}

export function createProgramState(): ProgramState {
  return {
    imports: {
      workflowEntrypoint: new Set(),
      workflow: new Set(),
      step: new Set(),
      sideffectNamespaces: new Set(),
      cloudflareNamespaces: new Set(),
    },
    workflowDefinitions: new Set(),
  };
}

export function initializeProgramState(program: Node): ProgramState {
  const state = createProgramState();
  for (const statement of nodeList(program.body)) {
    if (statement.type === "ImportDeclaration") {
      collectImportAliases(statement, state.imports);
      continue;
    }

    const declarationStatement =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;

    if (declarationStatement?.type !== "VariableDeclaration") {
      continue;
    }

    for (const declaration of declarationStatement.declarations ?? []) {
      const id = declaration.id;
      const initializer = declaration.init;
      if (isIdentifier(id) && initializer && isWorkflowMakeCall(initializer, state)) {
        state.workflowDefinitions.add(id.name);
      }
    }
  }
  return state;
}

export function getAncestors(context: RuleContext, node: Node): Array<Node> {
  return context.sourceCode.getAncestors(node as never) as unknown as Array<Node>;
}

export function findWorkflowContext(
  context: RuleContext,
  node: Node,
  state: ProgramState,
): WorkflowContextInfo | undefined {
  const ancestors = getAncestors(context, node);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (!isFunctionLike(ancestor)) {
      continue;
    }

    const native = nativeWorkflowContext(ancestor, ancestors, index, state);
    if (native) {
      return withWorkflowAliases(native, node);
    }

    const sideffect = sideffectWorkflowContext(ancestor, ancestors, index, state);
    if (sideffect) {
      return withWorkflowAliases(sideffect, node);
    }
  }
}

export function isStepCall(call: Node, workflow: WorkflowContextInfo | undefined): boolean {
  if (!workflow || call.type !== "CallExpression") {
    return false;
  }

  const callee = unwrapExpression(call.callee);
  if (callee?.type !== "MemberExpression" || callee.computed) {
    return false;
  }

  const object = unwrapExpression(callee.object);
  const property = callee.property;
  return (
    isIdentifier(object) &&
    object.name === workflow.stepName &&
    isIdentifier(property) &&
    stepMethodNames.has(property.name)
  );
}

export function stepCallMethod(call: Node): string | undefined {
  const callee = unwrapExpression(call.callee);
  if (callee?.type !== "MemberExpression") {
    return;
  }
  const property = callee.property;
  return isIdentifier(property) ? property.name : undefined;
}

export function isPromiseRaceOrAnyCall(call: Node): boolean {
  if (call.type !== "CallExpression") {
    return false;
  }
  const callee = unwrapExpression(call.callee);
  if (callee?.type !== "MemberExpression") {
    return false;
  }
  const object = callee.object;
  const property = callee.property;
  return (
    isIdentifier(object) &&
    object.name === "Promise" &&
    isIdentifier(property) &&
    ["race", "any"].includes(property.name)
  );
}

export function containsStepCall(node: Node | undefined, workflow: WorkflowContextInfo): boolean {
  if (!node) {
    return false;
  }

  if (node.type === "CallExpression" && containsStepCallInEagerCallback(node, workflow)) {
    return true;
  }

  if (isFunctionLike(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    return false;
  }

  if (node.type === "CallExpression" && isStepCall(node, workflow)) {
    return true;
  }

  for (const child of childNodes(node)) {
    if (containsStepCall(child, workflow)) {
      return true;
    }
  }

  return false;
}

export function isInsideStepDoCallback(
  context: RuleContext,
  node: Node,
  workflow: WorkflowContextInfo,
): boolean {
  const ancestors = getAncestors(context, node);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (!isFunctionLike(ancestor)) {
      continue;
    }

    const parent = ancestors[index - 1];
    if (parent?.type !== "CallExpression") {
      continue;
    }

    if (isStepCall(parent, workflow) && stepCallMethod(parent) === "do") {
      return true;
    }
  }
  return false;
}

export function isConsumedStepCall(
  context: RuleContext,
  call: Node,
  workflow: WorkflowContextInfo,
): boolean {
  return isOwnedExpression(context, call, workflow);
}

export function isOwnedExpression(
  context: RuleContext,
  expression: Node,
  workflow: WorkflowContextInfo,
): boolean {
  const ancestors = getAncestors(context, expression);
  const parent = ancestors.at(-1);
  if (!parent) {
    return false;
  }

  if (parent.type === "AwaitExpression" || parent.type === "YieldExpression") {
    return isEnclosingFunctionOwned(context, expression, workflow);
  }

  if (parent.type === "ReturnStatement") {
    const effectCall = ancestors.findLast(isEffectPromiseCall);
    if (effectCall && isReturnedFromEffectCallback(ancestors, effectCall)) {
      return isOwnedEffectCall(context, effectCall, workflow);
    }

    return nearestFunction(ancestors) === workflow.functionNode;
  }

  if (parent.type === "MemberExpression") {
    const chainCall = ancestors.at(-2);
    if (chainCall?.type !== "CallExpression") {
      return false;
    }
    const method = propertyName(parent.property);
    if (method === "then" || method === "catch" || method === "finally") {
      return isOwnedAncestorExpression(context, chainCall, workflow);
    }
  }

  if (parent.type === "ArrowFunctionExpression" && parent.body === expression) {
    if (parent === workflow.functionNode || isInsideStepDoCallback(context, expression, workflow)) {
      return true;
    }

    const effectCall = ancestors.findLast(isEffectPromiseCall);
    if (effectCall && isOwnedEffectCall(context, effectCall, workflow)) {
      return true;
    }
  }

  if (parent.type === "ArrayExpression") {
    const callParent = ancestors.at(-2);
    if (callParent?.type !== "CallExpression") {
      return false;
    }
    const callee = unwrapExpression(callParent.callee);
    if (callee?.type !== "MemberExpression") {
      return false;
    }
    const object = callee.object;
    const property = callee.property;
    const method = isIdentifier(property) ? property.name : undefined;
    if (
      isIdentifier(object) &&
      object.name === "Promise" &&
      (method === "all" || method === "allSettled" || method === "race" || method === "any")
    ) {
      return isOwnedAncestorExpression(context, callParent, workflow);
    }
  }

  return false;
}

export function isEventMutationTarget(
  context: RuleContext,
  target: Node,
  workflow: WorkflowContextInfo,
): boolean {
  if (isIdentifier(target)) {
    return false;
  }

  const base = memberBase(target);
  if (!isIdentifier(base)) {
    return false;
  }

  const bindingKind = protectedBindingKindAt(context, base, workflow);
  if (bindingKind) {
    return true;
  }
  if (isShadowedProtectedName(context, base, workflow)) {
    return false;
  }

  const baseName = base.name;
  if (workflow.eventNames.has(baseName) || workflow.payloadNames.has(baseName)) {
    return true;
  }

  const path = memberPath(target);
  if (path.length < 2) {
    return false;
  }
  if (path[0] !== baseName) {
    return false;
  }

  return (
    matchesProtectedPath(path, workflow.eventNames) ||
    matchesProtectedPath(path, workflow.payloadNames)
  );
}

export function isEventMutatingCall(
  context: RuleContext,
  call: Node,
  workflow: WorkflowContextInfo,
): boolean {
  const callee = unwrapExpression(call.callee);
  if (callee?.type !== "MemberExpression" || callee.computed) {
    return false;
  }

  if (memberPath(callee).join(".") === "Object.assign") {
    const target = nodeList(call.arguments)[0];
    return target ? isEventMutationObjectTarget(context, target, workflow) : false;
  }

  const method = propertyName(callee.property);
  if (!method || !mutatingMethodNames.has(method)) {
    return false;
  }

  return isNode(callee.object) && isEventMutationTarget(context, callee.object, workflow);
}

function isEventMutationObjectTarget(
  context: RuleContext,
  target: Node,
  workflow: WorkflowContextInfo,
): boolean {
  if (!isIdentifier(target)) {
    return isEventMutationTarget(context, target, workflow);
  }
  const bindingKind = protectedBindingKindAt(context, target, workflow);
  if (bindingKind) {
    return true;
  }
  if (isShadowedProtectedName(context, target, workflow)) {
    return false;
  }
  return workflow.eventNames.has(target.name) || workflow.payloadNames.has(target.name);
}

export function nameArgumentForStepCall(
  call: Node,
  workflow: WorkflowContextInfo,
): Node | undefined {
  const args = nodeList(call.arguments);
  const method = stepCallMethod(call);
  if (workflow.kind === "native") {
    return args[0];
  }
  if (method === "sleep" || method === "sleepUntil" || method === "waitForEvent") {
    return args[0];
  }
}

export function isStepMakeCall(call: Node, state: ProgramState): boolean {
  const callee = unwrapExpression(call.callee);
  if (callee?.type !== "MemberExpression") {
    return false;
  }
  const property = callee.property;
  if (!isIdentifier(property) || property.name !== "make") {
    return false;
  }
  const object = unwrapExpression(callee.object);
  if (isIdentifier(object)) {
    return state.imports.step.has(object.name);
  }
  return isNamespaceMember(object, state.imports.sideffectNamespaces, "Step");
}

export function hasNondeterministicExpression(node: Node | undefined): boolean {
  if (!node) {
    return false;
  }

  if (node.type === "CallExpression") {
    const callee = unwrapExpression(node.callee);
    const path = memberPath(callee);
    if (
      (isIdentifier(callee) && callee.name === "Date") ||
      path.join(".") === "Date.now" ||
      path.join(".") === "Math.random" ||
      path.join(".") === "crypto.randomUUID" ||
      path.join(".") === "globalThis.crypto.randomUUID"
    ) {
      return true;
    }
  }

  if (node.type === "NewExpression") {
    const callee = unwrapExpression(node.callee);
    if (isIdentifier(callee) && callee.name === "Date") {
      return true;
    }
  }

  for (const child of childNodes(node)) {
    if (hasNondeterministicExpression(child)) {
      return true;
    }
  }

  return false;
}

export function stepDoTimeoutNode(call: Node, workflow: WorkflowContextInfo): Node | undefined {
  if (stepCallMethod(call) !== "do") {
    return;
  }
  const args = nodeList(call.arguments);
  const config = workflow.kind === "native" ? args[1] : args[2];
  if (!config || config.type !== "ObjectExpression") {
    return;
  }

  for (const property of config.properties ?? []) {
    if (property.type !== "Property") {
      continue;
    }
    if (propertyName(property.key) !== "timeout") {
      continue;
    }
    return isNode(property.value) ? property.value : undefined;
  }
}

export function literalString(node: Node | undefined): string | undefined {
  if (!node) {
    return;
  }
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && (node.expressions ?? []).length === 0) {
    const quasi = nodeList(node.quasis)[0];
    const value = quasi?.value;
    if (isTemplateValue(value)) {
      return value.cooked || value.raw;
    }
  }
}

export function literalDurationValue(node: Node | undefined): string | number | undefined {
  if (
    node?.type === "Literal" &&
    (typeof node.value === "string" || typeof node.value === "number")
  ) {
    return node.value;
  }
  return literalString(node);
}

function collectImportAliases(statement: Node, imports: ImportAliases): void {
  if (statement.source?.type !== "Literal") {
    return;
  }

  const module = String(statement.source.value);
  for (const specifier of nodeList(statement.specifiers)) {
    const local = specifier.local;
    if (!isIdentifier(local)) {
      continue;
    }
    const localName = local.name;

    if (module === "sideffect" && specifier.type === "ImportNamespaceSpecifier") {
      imports.sideffectNamespaces.add(localName);
      continue;
    }

    if (module === "cloudflare:workers" && specifier.type === "ImportNamespaceSpecifier") {
      imports.cloudflareNamespaces.add(localName);
      continue;
    }

    if (isLocalSpecifier(module) && /workflow$/i.test(localName)) {
      // Syntax-only local import tracking for workflow definitions exported from sibling modules.
      imports.workflow.add(localName);
      continue;
    }

    const imported = specifier.imported;
    if (!isIdentifier(imported)) {
      continue;
    }
    const importedName = imported.name;
    if (module === "cloudflare:workers" && importedName === "WorkflowEntrypoint") {
      imports.workflowEntrypoint.add(localName);
    }
    if (module === "sideffect" && importedName === "Workflow") {
      imports.workflow.add(localName);
    }
    if (module === "sideffect" && importedName === "Step") {
      imports.step.add(localName);
    }
  }
}

function nativeWorkflowContext(
  fn: Node,
  ancestors: Array<Node>,
  index: number,
  state: ProgramState,
): WorkflowContextInfo | undefined {
  const method = ancestors[index - 1];
  const classBody = ancestors[index - 2];
  const classNode = ancestors[index - 3];
  if (method?.type !== "MethodDefinition" || classBody?.type !== "ClassBody" || !classNode) {
    return;
  }
  if (propertyName(method.key) !== "run") {
    return;
  }
  const superClass = unwrapExpression(classNode.superClass ?? undefined);
  if (!isWorkflowEntrypoint(superClass, state)) {
    return;
  }
  const [eventParam, stepParam] = nodeList(fn.params);
  if (!isIdentifier(eventParam) || !isIdentifier(stepParam)) {
    return;
  }
  const event = eventParam.name;
  const step = stepParam.name;
  return {
    kind: "native",
    functionNode: fn,
    eventNames: new Set([event]),
    payloadNames: new Set([`${event}.payload`]),
    stepName: step,
  };
}

function sideffectWorkflowContext(
  fn: Node,
  ancestors: Array<Node>,
  index: number,
  state: ProgramState,
): WorkflowContextInfo | undefined {
  const callbackCall = ancestors[index - 1];
  if (callbackCall?.type !== "CallExpression") {
    return;
  }

  const call = isEffectFnCall(callbackCall) ? ancestors[index - 2] : callbackCall;
  const callbackArgument = isEffectFnCall(callbackCall) ? callbackCall : fn;
  if (call?.type !== "CallExpression" || call.arguments?.[0] !== callbackArgument) {
    return;
  }
  const callee = unwrapExpression(call.callee);
  if (callee?.type !== "MemberExpression" || propertyName(callee.property) !== "toLayer") {
    return;
  }
  const receiver = unwrapExpression(callee.object);
  const isWorkflow =
    isWorkflowMakeCall(receiver, state) ||
    (isIdentifier(receiver) &&
      (state.workflowDefinitions.has(receiver.name) || state.imports.workflow.has(receiver.name)));
  if (!isWorkflow) {
    return;
  }

  const params = nodeList(fn.params);
  const stepParam = params[1];
  if (!isIdentifier(stepParam)) {
    return;
  }
  const step = stepParam.name;

  const eventNames = new Set<string>();
  const payloadNames = new Set<string>();
  const workflowParam = params[0];
  if (isIdentifier(workflowParam)) {
    const name = workflowParam.name;
    eventNames.add(`${name}.event`);
    payloadNames.add(`${name}.payload`);
    payloadNames.add(`${name}.event.payload`);
  }
  if (workflowParam?.type === "ObjectPattern") {
    for (const property of nodeList(workflowParam.properties)) {
      if (property.type !== "Property") {
        continue;
      }
      const key = propertyName(property.key);
      const value = isNode(property.value) ? property.value : undefined;
      if (key === "event" && isIdentifier(value)) {
        eventNames.add(value.name);
        payloadNames.add(`${value.name}.payload`);
      }
      if (key === "payload" && isIdentifier(value)) {
        payloadNames.add(value.name);
      }
    }
  }

  return { kind: "sideffect", functionNode: fn, eventNames, payloadNames, stepName: step };
}

function withWorkflowAliases(
  workflow: WorkflowContextInfo,
  referenceNode: Node,
): WorkflowContextInfo {
  const eventNames = new Set(workflow.eventNames);
  const payloadNames = new Set(workflow.payloadNames);
  const aliasedWorkflow = { ...workflow, eventNames, payloadNames };
  const referenceStart = nodeStart(referenceNode);

  collectWorkflowAliases(
    workflow.functionNode,
    aliasedWorkflow,
    eventNames,
    payloadNames,
    referenceStart,
  );

  return aliasedWorkflow;
}

function collectWorkflowAliases(
  node: Node,
  workflow: WorkflowContextInfo,
  eventNames: Set<string>,
  payloadNames: Set<string>,
  referenceStart: number | undefined,
): void {
  for (const child of childNodes(node)) {
    if (
      child !== node &&
      (isFunctionLike(child) ||
        child.type === "ClassDeclaration" ||
        child.type === "ClassExpression")
    ) {
      continue;
    }

    if (child.type === "VariableDeclarator") {
      const declarationStart = nodeStart(child);
      if (
        referenceStart === undefined ||
        declarationStart === undefined ||
        declarationStart < referenceStart
      ) {
        collectVariableAliases(child, workflow, eventNames, payloadNames);
      }
    }

    collectWorkflowAliases(child, workflow, eventNames, payloadNames, referenceStart);
  }
}

function collectVariableAliases(
  declaration: Node,
  workflow: WorkflowContextInfo,
  eventNames: Set<string>,
  payloadNames: Set<string>,
): void {
  const id = declaration.id;
  const initializer = isNode(declaration.init) ? declaration.init : undefined;
  if (!id || !initializer) {
    return;
  }

  if (isIdentifier(id)) {
    const kind = protectedPathKind(initializer, workflow);
    if (kind === "event") {
      eventNames.add(id.name);
      payloadNames.add(`${id.name}.payload`);
    }
    if (kind === "payload") {
      payloadNames.add(id.name);
    }
    return;
  }

  if (id.type !== "ObjectPattern") {
    return;
  }

  const initializerKind = protectedPathKind(initializer, workflow);
  for (const property of nodeList(id.properties)) {
    if (property.type !== "Property") {
      continue;
    }

    const key = propertyName(property.key);
    const value = isNode(property.value) ? property.value : undefined;
    if (!isIdentifier(value)) {
      continue;
    }

    if (initializerKind === "event" && key === "payload") {
      payloadNames.add(value.name);
      continue;
    }

    if (initializerKind === "payload") {
      payloadNames.add(value.name);
      continue;
    }

    if (key === "event") {
      const candidate = memberExpressionPath(initializer, "event");
      if (protectedPathKind(candidate, workflow) === "event") {
        eventNames.add(value.name);
        payloadNames.add(`${value.name}.payload`);
      }
      continue;
    }

    if (key === "payload") {
      const candidate = memberExpressionPath(initializer, "payload");
      if (protectedPathKind(candidate, workflow) === "payload") {
        payloadNames.add(value.name);
      }
    }
  }
}

function protectedPathKind(
  node: Node,
  workflow: Pick<WorkflowContextInfo, "eventNames" | "payloadNames">,
): "event" | "payload" | undefined {
  const base = memberBase(node);
  if (!isIdentifier(base)) {
    return;
  }
  const path = memberPath(node);
  if (path.length === 0 || path[0] !== base.name) {
    return;
  }

  if (matchesProtectedPath(path, workflow.payloadNames)) {
    return "payload";
  }
  if (matchesProtectedPath(path, workflow.eventNames)) {
    return "event";
  }
}

function memberExpressionPath(object: Node, property: string): Node {
  return {
    type: "MemberExpression",
    object,
    property: { type: "Identifier", name: property },
    computed: false,
  };
}

function nodeStart(node: Node): number | undefined {
  const rangeStart = node.range?.[0];
  return typeof rangeStart === "number" ? rangeStart : undefined;
}

function isWorkflowEntrypoint(node: Node | undefined, state: ProgramState): boolean {
  if (isIdentifier(node)) {
    return state.imports.workflowEntrypoint.has(node.name);
  }
  return isNamespaceMember(node, state.imports.cloudflareNamespaces, "WorkflowEntrypoint");
}

function isEffectFnCall(node: Node | undefined): boolean {
  if (node?.type !== "CallExpression") {
    return false;
  }
  const callee = unwrapExpression(node.callee);
  return memberPath(callee).join(".") === "Effect.fn";
}

function isEffectPromiseCall(node: Node | undefined): boolean {
  if (node?.type !== "CallExpression") {
    return false;
  }
  const callee = unwrapExpression(node.callee);
  const path = memberPath(callee).join(".");
  return path === "Effect.promise" || path === "Effect.tryPromise";
}

function isOwnedEffectCall(
  context: RuleContext,
  effectCall: Node,
  workflow: WorkflowContextInfo,
): boolean {
  if (isOwnedAncestorExpression(context, effectCall, workflow)) {
    return true;
  }

  const ancestors = getAncestors(context, effectCall);
  const parent = ancestors.at(-1);
  const pipeCall = ancestors.at(-2);
  if (parent?.type !== "MemberExpression" || pipeCall?.type !== "CallExpression") {
    return false;
  }

  if (propertyName(parent.property) !== "pipe") {
    return false;
  }

  return isOwnedAncestorExpression(context, pipeCall, workflow);
}

function isReturnedFromEffectCallback(ancestors: Array<Node>, effectCall: Node): boolean {
  const effectCallIndex = ancestors.indexOf(effectCall);
  if (effectCallIndex < 0) {
    return false;
  }

  const callback = ancestors[effectCallIndex + 1];
  return isFunctionLike(callback);
}

function isEnclosingFunctionOwned(
  context: RuleContext,
  expression: Node,
  workflow: WorkflowContextInfo,
): boolean {
  const ancestors = getAncestors(context, expression);
  const fn = nearestFunction(ancestors);
  if (!fn) {
    return false;
  }
  if (fn === workflow.functionNode || isInsideStepDoCallback(context, expression, workflow)) {
    return true;
  }

  const functionIndex = ancestors.indexOf(fn);
  const call = ancestors[functionIndex - 1];
  if (!isEagerArrayCallbackCall(call) || !nodeList(call.arguments).includes(fn)) {
    return false;
  }

  return isOwnedPromiseAggregateArgument(context, call, workflow);
}

function containsStepCallInEagerCallback(call: Node, workflow: WorkflowContextInfo): boolean {
  if (!isEagerArrayCallbackCall(call)) {
    return false;
  }

  return nodeList(call.arguments).some((argument) => {
    if (!isFunctionLike(argument) || !isNode(argument.body)) {
      return false;
    }
    return containsStepCall(argument.body, workflow);
  });
}

function isEagerArrayCallbackCall(node: Node | undefined): boolean {
  if (node?.type !== "CallExpression") {
    return false;
  }
  const callee = unwrapExpression(node.callee);
  if (callee?.type !== "MemberExpression") {
    return false;
  }
  const method = propertyName(callee.property);
  return method === "map" || method === "flatMap";
}

function isOwnedPromiseAggregateArgument(
  context: RuleContext,
  expression: Node,
  workflow: WorkflowContextInfo,
): boolean {
  const ancestors = getAncestors(context, expression);
  const parent = ancestors.at(-1);
  if (parent?.type !== "CallExpression" || !nodeList(parent.arguments).includes(expression)) {
    return false;
  }
  const callee = unwrapExpression(parent.callee);
  if (callee?.type !== "MemberExpression") {
    return false;
  }
  const object = callee.object;
  const method = propertyName(callee.property);
  if (
    !isIdentifier(object) ||
    object.name !== "Promise" ||
    !method ||
    !["all", "allSettled", "race", "any"].includes(method)
  ) {
    return false;
  }
  return isOwnedAncestorExpression(context, parent, workflow);
}

function isOwnedAncestorExpression(
  context: RuleContext,
  expression: Node,
  workflow: WorkflowContextInfo,
): boolean {
  const ancestors = getAncestors(context, expression);
  const parent = ancestors.at(-1);
  if (!parent) {
    return false;
  }
  if (parent.type === "AwaitExpression" || parent.type === "YieldExpression") {
    return true;
  }
  if (parent.type === "ReturnStatement") {
    return nearestFunction(ancestors) === workflow.functionNode;
  }
  if (parent.type === "MemberExpression") {
    const chainCall = ancestors.at(-2);
    if (chainCall?.type !== "CallExpression") {
      return false;
    }
    const method = propertyName(parent.property);
    if (method === "then" || method === "catch" || method === "finally") {
      return isOwnedAncestorExpression(context, chainCall, workflow);
    }
  }
  if (parent.type === "ArrowFunctionExpression" && parent.body === expression) {
    return (
      parent === workflow.functionNode || isInsideStepDoCallback(context, expression, workflow)
    );
  }
  return false;
}

function protectedBindingKindAt(
  context: RuleContext,
  identifier: Node & { readonly name: string },
  workflow: WorkflowContextInfo,
): "event" | "payload" | undefined {
  const bindingKind = bindingKindBefore(context, identifier, workflow);
  if (bindingKind === "event" || bindingKind === "payload") {
    return bindingKind;
  }
}

function isShadowedProtectedName(
  context: RuleContext,
  identifier: Node & { readonly name: string },
  workflow: WorkflowContextInfo,
): boolean {
  if (!workflow.eventNames.has(identifier.name) && !workflow.payloadNames.has(identifier.name)) {
    return false;
  }
  return bindingKindBefore(context, identifier, workflow) === "local";
}

function bindingKindBefore(
  context: RuleContext,
  identifier: Node & { readonly name: string },
  workflow: WorkflowContextInfo,
): "event" | "payload" | "local" | undefined {
  const referenceStart = nodeStart(identifier);
  if (referenceStart === undefined) {
    return;
  }

  let bestStart = -1;
  let bestKind: "event" | "payload" | "local" | undefined;
  collectBindingKinds(
    workflow.functionNode,
    identifier.name,
    referenceStart,
    workflow,
    (start, kind) => {
      if (start > bestStart) {
        bestStart = start;
        bestKind = kind;
      }
    },
  );
  return bestKind;
}

function collectBindingKinds(
  node: Node,
  name: string,
  referenceStart: number,
  workflow: WorkflowContextInfo,
  collect: (start: number, kind: "event" | "payload" | "local") => void,
): void {
  for (const child of childNodes(node)) {
    if (
      child !== node &&
      (isFunctionLike(child) ||
        child.type === "ClassDeclaration" ||
        child.type === "ClassExpression")
    ) {
      continue;
    }

    if (child.type === "VariableDeclarator") {
      const declarationStart = nodeStart(child);
      const kind = variableBindingKind(child, name, workflow);
      if (declarationStart !== undefined && declarationStart < referenceStart && kind) {
        collect(declarationStart, kind);
      }
    }

    if (shouldDescendForBinding(child, referenceStart)) {
      collectBindingKinds(child, name, referenceStart, workflow, collect);
    }
  }
}

function shouldDescendForBinding(node: Node, referenceStart: number): boolean {
  if (nodeContainsStart(node, referenceStart)) {
    return true;
  }
  return [
    "ExportDefaultDeclaration",
    "ExportNamedDeclaration",
    "VariableDeclaration",
    "VariableDeclarator",
  ].includes(String(node.type));
}

function nodeContainsStart(node: Node, start: number): boolean {
  const rangeStart = node.range?.[0];
  const rangeEnd = node.range?.[1];
  return (
    typeof rangeStart === "number" &&
    typeof rangeEnd === "number" &&
    rangeStart <= start &&
    start <= rangeEnd
  );
}

function variableBindingKind(
  declaration: Node,
  name: string,
  workflow: WorkflowContextInfo,
): "event" | "payload" | "local" | undefined {
  const id = declaration.id;
  const initializer = isNode(declaration.init) ? declaration.init : undefined;
  if (!id) {
    return;
  }

  if (isIdentifier(id) && id.name === name) {
    return initializer ? (protectedPathKind(initializer, workflow) ?? "local") : "local";
  }

  if (id.type !== "ObjectPattern") {
    return;
  }

  const initializerKind = initializer ? protectedPathKind(initializer, workflow) : undefined;
  for (const property of nodeList(id.properties)) {
    if (property.type !== "Property") {
      continue;
    }
    const value = isNode(property.value) ? property.value : undefined;
    if (!isIdentifier(value) || value.name !== name) {
      continue;
    }

    const key = propertyName(property.key);
    if ((initializerKind === "event" && key === "payload") || initializerKind === "payload") {
      return "payload";
    }
    if (
      key === "event" &&
      initializer &&
      protectedPathKind(memberExpressionPath(initializer, "event"), workflow) === "event"
    ) {
      return "event";
    }
    if (
      key === "payload" &&
      initializer &&
      protectedPathKind(memberExpressionPath(initializer, "payload"), workflow) === "payload"
    ) {
      return "payload";
    }
    return "local";
  }
}

function nearestFunction(ancestors: Array<Node>): Node | undefined {
  return ancestors.findLast(isFunctionLike);
}

function matchesProtectedPath(path: Array<string>, protectedPaths: ReadonlySet<string>): boolean {
  for (let index = path.length; index >= 1; index -= 1) {
    if (protectedPaths.has(path.slice(0, index).join("."))) {
      return true;
    }
  }
  return false;
}

function isLocalSpecifier(module: string): boolean {
  return module.startsWith("./") || module.startsWith("../");
}

function isWorkflowMakeCall(expression: Node | undefined, state: ProgramState): boolean {
  if (!expression || expression.type !== "CallExpression") {
    return false;
  }
  const callee = unwrapExpression(expression.callee);
  if (callee?.type !== "MemberExpression" || propertyName(callee.property) !== "make") {
    return false;
  }
  const object = unwrapExpression(callee.object);
  if (isIdentifier(object)) {
    return state.imports.workflow.has(object.name);
  }
  return isNamespaceMember(object, state.imports.sideffectNamespaces, "Workflow");
}

function isNamespaceMember(node: Node | undefined, namespaces: Set<string>, name: string): boolean {
  if (node?.type !== "MemberExpression") {
    return false;
  }
  const object = node.object;
  const property = node.property;
  return (
    isIdentifier(object) &&
    namespaces.has(object.name) &&
    isIdentifier(property) &&
    property.name === name
  );
}

function isFunctionLike(node: Node): boolean {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(
    String(node.type),
  );
}

const mutatingMethodNames = new Set([
  "add",
  "clear",
  "copyWithin",
  "delete",
  "fill",
  "pop",
  "push",
  "reverse",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

function memberBase(node: Node): Node | undefined {
  let current: Node | undefined = unwrapExpression(node);
  while (current?.type === "MemberExpression") {
    current = unwrapExpression(current.object);
  }
  return current;
}

function memberPath(node: Node | undefined): Array<string> {
  const current = unwrapExpression(node);
  if (!current) {
    return [];
  }
  if (isIdentifier(current)) {
    return [current.name];
  }
  if (current.type !== "MemberExpression") {
    return [];
  }
  const objectPath = memberPath(current.object);
  const property = propertyName(current.property);
  return property ? [...objectPath, property] : objectPath;
}

function unwrapExpression(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current &&
    [
      "ChainExpression",
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "TSTypeAssertion",
    ].includes(String(current.type))
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(node: Node | undefined): string | undefined {
  if (isIdentifier(node) || isPrivateIdentifier(node)) {
    return node.name;
  }
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
}

function nodeList(value: unknown): Array<Node> {
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function isIdentifier(node: Node | undefined): node is Node & { readonly name: string } {
  return node?.type === "Identifier" && typeof node.name === "string";
}

function isPrivateIdentifier(node: Node | undefined): node is Node & { readonly name: string } {
  return node?.type === "PrivateIdentifier" && typeof node.name === "string";
}

function isTemplateValue(
  value: unknown,
): value is { readonly cooked?: string; readonly raw?: string } {
  return typeof value === "object" && value !== null;
}

function childNodes(node: Node): Array<Node> {
  const children: Array<Node> = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") {
      continue;
    }
    if (Array.isArray(value)) {
      children.push(...value.filter(isNode));
      continue;
    }
    if (isNode(value)) {
      children.push(value);
    }
  }

  return children;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
