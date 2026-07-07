import { AgentWorker, AgentWorkerResult } from "./AgentWorker";
import { Task } from "../orchestrator/types";

export class MockWorker implements AgentWorker {
  public async run(task: Task, signal: AbortSignal): Promise<AgentWorkerResult> {
    await this.wait(700, signal);

    if (signal.aborted) {
      return {
        status: "failed",
        summary: "Mock worker was canceled before completion.",
        filesTouched: task.filesTouched
      };
    }

    await this.wait(900, signal);

    return {
      status: "completed",
      summary: `Mock worker completed "${task.title}". Replace MockWorker with a real Cursor SDK, MCP, or agent runner integration when available.`,
      filesTouched: [...new Set([...task.filesTouched, ...task.predictedFiles])]
    };
  }

  private async wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, milliseconds);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
    });
  }
}
