import { ds } from "./design";

export type TokenKind =
  | "comment"
  | "identifier"
  | "keyword"
  | "number"
  | "plain"
  | "property"
  | "punctuation"
  | "string"
  | "type";

export type CodeToken = readonly [text: string, kind: TokenKind];

const keywords = new Set([
  "async",
  "await",
  "class",
  "const",
  "declare",
  "default",
  "export",
  "extends",
  "from",
  "global",
  "import",
  "interface",
  "namespace",
  "new",
  "return",
  "type",
]);

const identifiers = new Set([
  "Cloudflare",
  "Env",
  "Params",
  "Request",
  "Response",
  "Schema",
  "Step",
  "Uint8Array",
  "Workflow",
  "WorkflowEntrypoint",
  "cloudflare",
  "ctx",
  "defineConfig",
  "description",
  "describeImage",
  "env",
  "fetchImage",
  "image",
  "imageWorkflow",
  "instance",
  "object",
  "params",
  "payload",
  "publishImage",
  "step",
  "withCloudflareWorkflows",
  "workflow",
]);

const types = new Set(["ImageProcessing", "WorkflowEvent", "WorkflowStep"]);

const propertyNames = new Set([
  "BUCKET",
  "IMAGE_PROCESSING",
  "String",
  "Struct",
  "Uint8Array",
  "arrayBuffer",
  "create",
  "data",
  "do",
  "env",
  "get",
  "id",
  "imageKey",
  "json",
  "make",
  "payload",
  "run",
  "toLayer",
  "waitForEvent",
]);

export const syntaxColors: Record<TokenKind, string> = {
  comment: "#8a9199",
  identifier: "#399ee6",
  keyword: "#fa8d3e",
  number: "#a37acc",
  plain: ds.codeText,
  property: "#399ee6",
  punctuation: "#828c99",
  string: "#86b300",
  type: "#399ee6",
};

export const tokenizeLine = (line: string): CodeToken[] => {
  const tokens: CodeToken[] = [];
  let index = 0;

  const push = (text: string, kind: TokenKind) => {
    if (text.length > 0) {
      tokens.push([text, kind]);
    }
  };

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("//")) {
      push(rest, "comment");
      break;
    }

    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      push(whitespace[0], "plain");
      index += whitespace[0].length;
      continue;
    }

    const quoted = rest.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
    if (quoted) {
      push(quoted[0], "string");
      index += quoted[0].length;
      continue;
    }

    const property = rest.match(/^\.([A-Za-z_$][\w$]*)/);
    if (property) {
      push(".", "punctuation");
      push(property[1], propertyNames.has(property[1]) ? "property" : "identifier");
      index += property[0].length;
      continue;
    }

    const number = rest.match(/^\d+(?:\.\d+)?/);
    if (number) {
      push(number[0], "number");
      index += number[0].length;
      continue;
    }

    const word = rest.match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const text = word[0];
      const kind = keywords.has(text)
        ? "keyword"
        : types.has(text)
          ? "type"
          : identifiers.has(text)
            ? "identifier"
            : "plain";

      push(text, kind);
      index += text.length;
      continue;
    }

    const operator = rest.match(
      /^(=>|>=|<=|===|!==|==|!=|>|<|=|\+|-|\*|\/|:|,|;|\{|\}|\(|\)|\[|\]|\.)/,
    );
    if (operator) {
      push(operator[0], "punctuation");
      index += operator[0].length;
      continue;
    }

    push(rest[0], "plain");
    index += 1;
  }

  return tokens;
};
