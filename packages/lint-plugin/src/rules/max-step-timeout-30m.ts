import { parseDurationMilliseconds } from "../shared/duration.ts";
import {
  createProgramState,
  findWorkflowContext,
  initializeProgramState,
  isStepCall,
  literalDurationValue,
  stepDoTimeoutNode,
} from "../shared/ast.ts";
import type { Node, RuleContext, WorkflowRule, WorkflowVisitor } from "../types.ts";

const maxStepTimeoutMilliseconds = 30 * 60 * 1_000;

export const maxStepTimeout30mRule: WorkflowRule = {
  meta: {
    type: "problem",
    docs: { description: "Limit Workflow step.do timeouts to 30 minutes or less." },
    messages: {
      timeoutTooLong:
        "Workflow step.do timeout is longer than 30 minutes. Use a timeout of 30 minutes or less, or model long waits with waitForEvent.",
    },
    schema: [],
  },
  create: createMaxStepTimeout30m,
  createOnce: createMaxStepTimeout30m,
};

function createMaxStepTimeout30m(context: RuleContext): WorkflowVisitor {
  let state = createProgramState();

  return {
    Program(node: Node) {
      state = initializeProgramState(node);
    },
    CallExpression(node: Node) {
      const workflow = findWorkflowContext(context, node, state);
      if (!isStepCall(node, workflow) || !workflow) {
        return;
      }

      const timeout = stepDoTimeoutNode(node, workflow);
      const literal = literalDurationValue(timeout);
      const duration = literal !== undefined ? parseDurationMilliseconds(literal) : undefined;
      if (duration === undefined || duration <= maxStepTimeoutMilliseconds) {
        return;
      }

      context.report({ node: timeout as never, messageId: "timeoutTooLong" });
    },
  } as unknown as WorkflowVisitor;
}
