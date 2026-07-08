export interface Node {
  readonly type: string;
  readonly [key: string]: unknown;
  readonly argument?: Node;
  readonly arguments?: ReadonlyArray<Node>;
  readonly body?: Node | ReadonlyArray<Node>;
  readonly callee?: Node;
  readonly computed?: boolean;
  readonly cooked?: string;
  readonly declaration?: Node | null;
  readonly declarations?: ReadonlyArray<Node>;
  readonly expression?: Node;
  readonly expressions?: ReadonlyArray<Node>;
  readonly id?: Node;
  readonly imported?: Node;
  readonly init?: Node | null;
  readonly key?: Node;
  readonly left?: Node;
  readonly local?: Node;
  readonly name?: string;
  readonly object?: Node;
  readonly operator?: string;
  readonly params?: ReadonlyArray<Node>;
  readonly properties?: ReadonlyArray<Node>;
  readonly property?: Node;
  readonly quasis?: ReadonlyArray<Node>;
  readonly range?: ReadonlyArray<number>;
  readonly raw?: string;
  readonly source?: Node;
  readonly specifiers?: ReadonlyArray<Node>;
  readonly superClass?: Node | null;
  readonly value?: unknown;
}

export interface RuleContext {
  readonly sourceCode: {
    readonly getAncestors: (node: unknown) => Array<unknown>;
  };
  readonly report: (diagnostic: { readonly node: unknown; readonly messageId: string }) => void;
}

export type WorkflowVisitor = Record<string, (node: Node) => void>;

export interface WorkflowRule {
  readonly meta: {
    readonly type: "problem" | "suggestion" | "layout";
    readonly docs: { readonly description: string };
    readonly messages: Record<string, string>;
    readonly schema: Array<unknown>;
  };
  readonly create: (context: RuleContext) => WorkflowVisitor;
  readonly createOnce: (context: RuleContext) => WorkflowVisitor;
}

export interface WorkflowContextInfo {
  readonly kind: "native" | "sideffect";
  readonly functionNode: Node;
  readonly eventNames: ReadonlySet<string>;
  readonly payloadNames: ReadonlySet<string>;
  readonly stepName: string;
}
