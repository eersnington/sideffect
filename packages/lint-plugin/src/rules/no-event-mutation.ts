import {
  createProgramState,
  findWorkflowContext,
  isEventMutatingCall,
  initializeProgramState,
  isEventMutationTarget,
} from "../shared/ast.ts";
import type { Node, RuleContext, WorkflowRule, WorkflowVisitor } from "../types.ts";

export const noEventMutationRule: WorkflowRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow mutating Workflow event and payload state." },
    messages: {
      eventMutation:
        "Workflow event and payload values are immutable across retries and restarts. Return new step state instead of mutating them.",
    },
    schema: [],
  },
  create: createNoEventMutation,
  createOnce: createNoEventMutation,
};

function createNoEventMutation(context: RuleContext): WorkflowVisitor {
  let state = createProgramState();

  return {
    Program(node: Node) {
      state = initializeProgramState(node);
    },
    AssignmentExpression(node: Node) {
      const workflow = findWorkflowContext(context, node, state);
      const left = node.left as Node | undefined;
      if (!workflow || !left || !isEventMutationTarget(context, left, workflow)) {
        return;
      }
      context.report({ node: left as never, messageId: "eventMutation" });
    },
    CallExpression(node: Node) {
      const workflow = findWorkflowContext(context, node, state);
      if (!workflow || !isEventMutatingCall(context, node, workflow)) {
        return;
      }
      context.report({ node: node as never, messageId: "eventMutation" });
    },
    UpdateExpression(node: Node) {
      const workflow = findWorkflowContext(context, node, state);
      const argument = node.argument as Node | undefined;
      if (!workflow || !argument || !isEventMutationTarget(context, argument, workflow)) {
        return;
      }
      context.report({ node: argument as never, messageId: "eventMutation" });
    },
    UnaryExpression(node: Node) {
      if (node.operator !== "delete") {
        return;
      }
      const workflow = findWorkflowContext(context, node, state);
      const argument = node.argument as Node | undefined;
      if (!workflow || !argument || !isEventMutationTarget(context, argument, workflow)) {
        return;
      }
      context.report({ node: argument as never, messageId: "eventMutation" });
    },
  } as unknown as WorkflowVisitor;
}
