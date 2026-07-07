import * as crypto from "crypto";
import * as childProcess from "child_process";
import * as util from "util";
import * as vscode from "vscode";
import { ClassifierService } from "./ClassifierService";
import { FileLockManager } from "./FileLockManager";
import { TaskStore } from "./TaskStore";
import { ClassifierContext, RoutingDecision, Task, TaskRouteResult, UserPrompt } from "./types";

const execFile = util.promisify(childProcess.execFile);

export class TaskRouter {
  public constructor(
    private readonly store: TaskStore,
    private readonly lockManager: FileLockManager,
    private readonly classifier: ClassifierService,
    private readonly output: vscode.OutputChannel
  ) {}

  public async submitPrompt(text: string): Promise<TaskRouteResult> {
    const prompt: UserPrompt = {
      id: crypto.randomUUID(),
      text: text.trim(),
      createdAt: Date.now()
    };

    const context = await this.buildClassifierContext(prompt);
    let decision = await this.classifier.classify(context);
    decision = this.applySafetyOverrides(decision);
    this.logDecision(prompt, decision);

    if (decision.confidence < 0.55 && decision.action !== "ask_user_clarification") {
      decision = {
        ...decision,
        action: "ask_user_clarification",
        clarificationQuestion: "Should this be a new task, or should it attach to an existing task?"
      };
    }

    switch (decision.action) {
      case "append_to_existing_task":
        return this.appendToExistingTask(prompt, decision);
      case "queue_behind_conflicting_task":
        return this.createQueuedTask(prompt, decision);
      case "ask_user_clarification":
        void vscode.window.showInformationMessage(decision.clarificationQuestion ?? decision.reason);
        return { decision };
      case "create_new_task":
      default:
        return this.createRunningTask(prompt, decision);
    }
  }

  private async appendToExistingTask(prompt: UserPrompt, decision: RoutingDecision): Promise<TaskRouteResult> {
    if (!decision.targetTaskId) {
      return this.createRunningTask(prompt, {
        ...decision,
        action: "create_new_task",
        reason: "Classifier requested append without a target task, so a new task was created."
      });
    }

    const task = await this.store.appendPromptToTask(decision.targetTaskId, prompt);
    if (!task) {
      return this.createRunningTask(prompt, {
        ...decision,
        action: "create_new_task",
        reason: "Target task was not found, so a new task was created."
      });
    }

    return { decision, task };
  }

  private async createRunningTask(prompt: UserPrompt, decision: RoutingDecision): Promise<TaskRouteResult> {
    const task = this.createTaskFromDecision(prompt, decision, "running");
    await this.store.upsertTask(task);
    return { decision, task };
  }

  private async createQueuedTask(prompt: UserPrompt, decision: RoutingDecision): Promise<TaskRouteResult> {
    const task = this.createTaskFromDecision(prompt, decision, "queued");
    await this.store.upsertTask(task);
    return { decision, task, queuedBehindTaskId: decision.targetTaskId };
  }

  private createTaskFromDecision(prompt: UserPrompt, decision: RoutingDecision, status: Task["status"]): Task {
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      title: this.titleFromPrompt(prompt.text),
      status,
      summary: `Routing confidence: ${decision.confidence.toFixed(2)}\nRouting reason: ${decision.reason}\nInitial prompt: ${prompt.text}`.trim(),
      prompts: [prompt],
      queue: [],
      filesTouched: [],
      predictedFiles: decision.predictedFiles,
      featureAreas: decision.featureAreas,
      createdAt: now,
      updatedAt: now
    };
  }

  private applySafetyOverrides(decision: RoutingDecision): RoutingDecision {
    const conflicts = this.lockManager.findConflicts(decision.predictedFiles, decision.targetTaskId);
    if (conflicts.length === 0) {
      return decision;
    }

    return {
      ...decision,
      action: "queue_behind_conflicting_task",
      targetTaskId: conflicts[0].taskId,
      confidence: Math.max(decision.confidence, 0.75),
      reason: `Queued to avoid locked file conflict: ${conflicts.map((lock) => lock.filePath).join(", ")}.`
    };
  }

  private async buildClassifierContext(newPrompt: UserPrompt): Promise<ClassifierContext> {
    const buckets = this.store.getBuckets();
    const [recentGitDiffFiles, projectStructure] = await Promise.all([
      this.getRecentGitDiffFiles(),
      this.getProjectStructure()
    ]);

    return {
      newPrompt,
      activeTasks: buckets.running,
      queuedTasks: [...buckets.queued, ...buckets.paused, ...buckets.blocked],
      completedSummaries: buckets.completed.map((task) => ({
        id: task.id,
        title: task.title,
        summary: task.summary,
        featureAreas: task.featureAreas,
        filesTouched: task.filesTouched
      })),
      lockedFiles: this.lockManager.list(),
      recentGitDiffFiles,
      projectStructure
    };
  }

  private async getRecentGitDiffFiles(): Promise<string[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    try {
      const { stdout } = await execFile("git", ["diff", "--name-only", "HEAD"], {
        cwd: workspaceFolder.uri.fsPath
      });
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 100);
    } catch {
      return [];
    }
  }

  private async getProjectStructure(): Promise<string[]> {
    const files = await vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/out/**,**/.git/**}", 200);
    return files.map((uri) => vscode.workspace.asRelativePath(uri)).sort();
  }

  private titleFromPrompt(promptText: string): string {
    const trimmed = promptText.replace(/\s+/g, " ").trim();
    return trimmed.length > 64 ? `${trimmed.slice(0, 61)}...` : trimmed;
  }

  private logDecision(prompt: UserPrompt, decision: RoutingDecision): void {
    this.output.appendLine(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          promptId: prompt.id,
          prompt: prompt.text,
          decision
        },
        null,
        2
      )
    );
  }
}
