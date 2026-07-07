import * as vscode from "vscode";
import { FileLock, Task, TaskBucket, TaskStoreSnapshot } from "./types";

const STORAGE_KEY = "aiOrchestrator.taskStore.v1";

export class TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly locks = new Map<string, FileLock>();
  private readonly changeEmitter = new vscode.EventEmitter<TaskStoreSnapshot>();

  public readonly onDidChange = this.changeEmitter.event;

  public constructor(private readonly storage: vscode.Memento) {}

  public load(): void {
    const snapshot = this.storage.get<TaskStoreSnapshot>(STORAGE_KEY);
    if (!snapshot) {
      return;
    }

    this.tasks.clear();
    this.locks.clear();

    for (const task of snapshot.tasks) {
      this.tasks.set(task.id, task);
    }
    for (const lock of snapshot.locks) {
      this.locks.set(lock.filePath, lock);
    }
  }

  public async save(): Promise<void> {
    await this.storage.update(STORAGE_KEY, this.getSnapshot());
  }

  public getSnapshot(): TaskStoreSnapshot {
    return {
      tasks: this.getTasks(),
      locks: this.getLocks()
    };
  }

  public getTasks(): Task[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  public getLocks(): FileLock[] {
    return Array.from(this.locks.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  public getBuckets(): TaskBucket {
    const buckets: TaskBucket = {
      running: [],
      queued: [],
      paused: [],
      completed: [],
      failed: [],
      blocked: []
    };

    for (const task of this.getTasks()) {
      buckets[task.status].push(task);
    }

    return buckets;
  }

  public async upsertTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, { ...task, updatedAt: Date.now() });
    await this.emitAndSave();
    return this.tasks.get(task.id)!;
  }

  public async updateTask(taskId: string, update: Partial<Omit<Task, "id" | "createdAt">>): Promise<Task | undefined> {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return undefined;
    }

    const updated: Task = {
      ...existing,
      ...update,
      updatedAt: Date.now()
    };
    this.tasks.set(taskId, updated);
    await this.emitAndSave();
    return updated;
  }

  public async appendPromptToTask(taskId: string, promptQueueItem: Task["queue"][number]): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    const updated: Task = {
      ...task,
      queue: [...task.queue, promptQueueItem],
      summary: `${task.summary}\nQueued prompt: ${promptQueueItem.text}`.trim(),
      updatedAt: Date.now()
    };
    this.tasks.set(taskId, updated);
    await this.emitAndSave();
    return updated;
  }

  public async takeNextQueuedPrompt(taskId: string): Promise<Task["queue"][number] | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.queue.length === 0) {
      return undefined;
    }

    const [nextPrompt, ...remainingQueue] = task.queue;
    this.tasks.set(taskId, {
      ...task,
      prompts: [...task.prompts, nextPrompt],
      queue: remainingQueue,
      status: "running",
      updatedAt: Date.now()
    });
    await this.emitAndSave();
    return nextPrompt;
  }

  public async reassignQueuedPrompt(promptId: string, fromTaskId: string, toTaskId: string): Promise<void> {
    if (fromTaskId === toTaskId) {
      return;
    }

    const fromTask = this.tasks.get(fromTaskId);
    const toTask = this.tasks.get(toTaskId);
    if (!fromTask || !toTask) {
      return;
    }

    const prompt = fromTask.queue.find((item) => item.id === promptId);
    if (!prompt) {
      return;
    }

    this.tasks.set(fromTaskId, {
      ...fromTask,
      queue: fromTask.queue.filter((item) => item.id !== promptId),
      updatedAt: Date.now()
    });
    this.tasks.set(toTaskId, {
      ...toTask,
      queue: [...toTask.queue, prompt],
      summary: `${toTask.summary}\nPrompt manually reassigned from ${fromTask.title}.`.trim(),
      updatedAt: Date.now()
    });
    await this.emitAndSave();
  }

  public async clearCompleted(): Promise<void> {
    for (const task of this.tasks.values()) {
      if (task.status === "completed") {
        this.tasks.delete(task.id);
      }
    }
    await this.emitAndSave();
  }

  public async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    this.tasks.set(taskId, {
      ...task,
      status: "failed",
      summary: `${task.summary}\nCanceled by user.`.trim(),
      updatedAt: Date.now()
    });
    await this.releaseLocksForTask(taskId, false);
    await this.emitAndSave();
  }

  public async setLocks(locks: FileLock[], emit = true): Promise<void> {
    for (const lock of locks) {
      this.locks.set(lock.filePath, lock);
    }
    if (emit) {
      await this.emitAndSave();
    }
  }

  public async releaseLocksForTask(taskId: string, emit = true): Promise<void> {
    for (const [filePath, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        this.locks.delete(filePath);
      }
    }
    if (emit) {
      await this.emitAndSave();
    }
  }

  private async emitAndSave(): Promise<void> {
    await this.save();
    this.changeEmitter.fire(this.getSnapshot());
  }
}
