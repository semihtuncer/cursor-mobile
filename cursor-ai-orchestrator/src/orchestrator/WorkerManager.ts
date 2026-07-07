import * as vscode from "vscode";
import { AgentWorker } from "../workers/AgentWorker";
import { FileLockManager } from "./FileLockManager";
import { TaskStore } from "./TaskStore";
import { Task } from "./types";

export class WorkerManager {
  private readonly controllers = new Map<string, AbortController>();

  public constructor(
    private readonly store: TaskStore,
    private readonly lockManager: FileLockManager,
    private readonly worker: AgentWorker,
    private readonly output: vscode.OutputChannel
  ) {}

  public async startEligibleTasks(): Promise<void> {
    const tasks = this.store.getTasks();
    const runningTasks = tasks.filter((task) => task.status === "running");
    const queuedTasks = tasks.filter((task) => task.status === "queued");

    for (const task of [...runningTasks, ...queuedTasks]) {
      if (this.controllers.has(task.id)) {
        continue;
      }

      if (!this.lockManager.canLock(task.predictedFiles, task.id)) {
        if (task.status === "running") {
          await this.store.updateTask(task.id, {
            status: "queued",
            summary: `${task.summary}\nQueued because predicted files are currently locked.`.trim()
          });
        }
        continue;
      }

      await this.startTask(task);
    }
  }

  public async cancelTask(taskId: string): Promise<void> {
    this.controllers.get(taskId)?.abort();
    this.controllers.delete(taskId);
    this.lockManager.releaseTask(taskId);
    await this.store.cancelTask(taskId);
  }

  public async pauseTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) {
      return;
    }

    this.controllers.get(taskId)?.abort();
    this.controllers.delete(taskId);
    this.lockManager.releaseTask(taskId);
    await this.store.releaseLocksForTask(taskId, false);
    await this.store.updateTask(taskId, {
      status: "paused",
      summary: `${task.summary}\nPaused by user.`.trim()
    });
  }

  public async resumeTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task || task.status !== "paused") {
      return;
    }

    await this.store.updateTask(taskId, {
      status: "queued",
      summary: `${task.summary}\nResumed by user.`.trim()
    });
    await this.startEligibleTasks();
  }

  private async startTask(task: Task): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);

    const locks = this.lockManager.lockForTask(task);
    await this.store.setLocks(locks);
    await this.store.updateTask(task.id, {
      status: "running",
      summary: `${task.summary}\nMock worker started.`.trim()
    });

    void this.runTask(task.id, controller);
  }

  private async runTask(taskId: string, controller: AbortController): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) {
      this.controllers.delete(taskId);
      return;
    }

    try {
      const result = await this.worker.run(task, controller.signal);
      if (controller.signal.aborted) {
        return;
      }

      await this.store.updateTask(taskId, {
        status: result.status,
        filesTouched: result.filesTouched,
        summary: `${task.summary}\n${result.summary}`.trim()
      });
      this.output.appendLine(`Worker finished task ${taskId} with status ${result.status}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.updateTask(taskId, {
        status: "failed",
        summary: `${task.summary}\nWorker failed: ${message}`.trim()
      });
      this.output.appendLine(`Worker failed task ${taskId}: ${message}`);
    } finally {
      this.controllers.delete(taskId);
      this.lockManager.releaseTask(taskId);
      await this.store.releaseLocksForTask(taskId);

      if (controller.signal.aborted) {
        await this.startEligibleTasks();
        return;
      }

      const nextPrompt = await this.store.takeNextQueuedPrompt(taskId);
      if (nextPrompt) {
        await this.store.updateTask(taskId, {
          summary: `${this.store.getTask(taskId)?.summary ?? ""}\nProcessing queued prompt: ${nextPrompt.text}`.trim()
        });
      }

      await this.startEligibleTasks();
    }
  }
}
