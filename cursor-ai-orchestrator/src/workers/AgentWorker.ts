import { Task } from "../orchestrator/types";

export interface AgentWorker {
  run(task: Task, signal: AbortSignal): Promise<AgentWorkerResult>;
}

export type AgentWorkerResult = {
  status: "completed" | "failed" | "blocked";
  summary: string;
  filesTouched: string[];
};
