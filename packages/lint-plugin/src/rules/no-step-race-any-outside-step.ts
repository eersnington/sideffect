import {
  containsStepCall,
  createProgramState,
  findWorkflowContext,
  initializeProgramState,
  isInsideStepDoCallback,
  isPromiseRaceOrAnyCall,
} from "../shared/ast.ts";
import type { Node, RuleContext, WorkflowRule, WorkflowVisitor } from "../types.ts";

export const noStepRaceAnyOutsideStepRule: WorkflowRule = {
  meta: {
    type: "problem",
    docs: { description: "Require Promise.race and Promise.any over steps to run inside a step." },
    messages: {
      stepRaceOutsideStep:
        "Promise.race or Promise.any over Workflow steps can replay inconsistently. Wrap the race in a step.do callback.",
    },
    schema: [],
  },
  create: createNoStepRaceAnyOutsideStep,
  createOnce: createNoStepRaceAnyOutsideStep,
};

function createNoStepRaceAnyOutsideStep(context: RuleContext): WorkflowVisitor {
  let state = createProgramState();

  return {
    Program(node: Node) {
      state = initializeProgramState(node);
    },
    CallExpression(node: Node) {
      if (!isPromiseRaceOrAnyCall(node)) {
        return;
      }

      const workflow = findWorkflowContext(context, node, state);
      if (!workflow || isInsideStepDoCallback(context, node, workflow)) {
        return;
      }

      const args = Array.isArray(node.arguments) ? (node.arguments as Array<Node>) : [];
      if (!args.some((arg) => containsStepCall(arg, workflow))) {
        return;
      }

      context.report({ node: node as never, messageId: "stepRaceOutsideStep" });
    },
  } as unknown as WorkflowVisitor;
}
