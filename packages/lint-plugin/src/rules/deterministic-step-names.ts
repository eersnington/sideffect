import {
  createProgramState,
  findWorkflowContext,
  hasNondeterministicExpression,
  initializeProgramState,
  isStepCall,
  isStepMakeCall,
  nameArgumentForStepCall,
} from "../shared/ast.ts";
import type { Node, RuleContext, WorkflowRule, WorkflowVisitor } from "../types.ts";

export const deterministicStepNamesRule: WorkflowRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow obvious nondeterminism in Workflow step names." },
    messages: {
      nondeterministicStepName:
        "Workflow step names must be deterministic so cached step state can be reused after retries and restarts.",
    },
    schema: [],
  },
  create: createDeterministicStepNames,
  createOnce: createDeterministicStepNames,
};

function createDeterministicStepNames(context: RuleContext): WorkflowVisitor {
  let state = createProgramState();

  return {
    Program(node: Node) {
      state = initializeProgramState(node);
    },
    CallExpression(node: Node) {
      const workflow = findWorkflowContext(context, node, state);
      if (isStepCall(node, workflow)) {
        const name = workflow ? nameArgumentForStepCall(node, workflow) : undefined;
        if (hasNondeterministicExpression(name)) {
          context.report({ node: name as never, messageId: "nondeterministicStepName" });
        }
        return;
      }

      if (!isStepMakeCall(node, state)) {
        return;
      }
      const args = Array.isArray(node.arguments) ? (node.arguments as Array<Node>) : [];
      const name = args[0];
      if (hasNondeterministicExpression(name)) {
        context.report({ node: name as never, messageId: "nondeterministicStepName" });
      }
    },
  } as unknown as WorkflowVisitor;
}
