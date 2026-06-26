import {
  createProgramState,
  findWorkflowContext,
  initializeProgramState,
  isConsumedStepCall,
  isStepCall,
} from "../shared/ast.ts";
import type { Node, RuleContext, WorkflowRule, WorkflowVisitor } from "../types.ts";

export const awaitStepCallsRule: WorkflowRule = {
  meta: {
    type: "problem",
    docs: { description: "Require Workflow step calls to be awaited or returned." },
    messages: {
      danglingStepCall:
        "Workflow step call is not awaited, returned, or included in an awaited Promise aggregation.",
    },
    schema: [],
  },
  create: createAwaitStepCalls,
  createOnce: createAwaitStepCalls,
};

function createAwaitStepCalls(context: RuleContext): WorkflowVisitor {
  let state = createProgramState();

  return {
    Program(node: Node) {
      state = initializeProgramState(node);
    },
    CallExpression(node: Node) {
      const workflow = findWorkflowContext(context, node, state);
      if (!workflow || !isStepCall(node, workflow) || isConsumedStepCall(context, node, workflow)) {
        return;
      }

      context.report({ node: node as never, messageId: "danglingStepCall" });
    },
  } as unknown as WorkflowVisitor;
}
