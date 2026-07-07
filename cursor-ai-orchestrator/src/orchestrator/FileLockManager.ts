import { FileLock, Task } from "./types";

export class FileLockManager {
  private readonly locks = new Map<string, FileLock>();

  public hydrate(locks: FileLock[]): void {
    this.locks.clear();
    for (const lock of locks) {
      this.locks.set(this.normalize(lock.filePath), {
        ...lock,
        filePath: this.normalize(lock.filePath)
      });
    }
  }

  public list(): FileLock[] {
    return Array.from(this.locks.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  public findConflicts(filePaths: string[], requestingTaskId?: string): FileLock[] {
    const normalizedFiles = filePaths.map((filePath) => this.normalize(filePath)).filter(Boolean);
    const conflicts: FileLock[] = [];

    for (const filePath of normalizedFiles) {
      const lock = this.locks.get(filePath);
      if (lock && lock.taskId !== requestingTaskId) {
        conflicts.push(lock);
      }
    }

    return conflicts;
  }

  public canLock(filePaths: string[], requestingTaskId: string): boolean {
    return this.findConflicts(filePaths, requestingTaskId).length === 0;
  }

  public lockForTask(task: Task): FileLock[] {
    const filesToLock = [...new Set([...task.predictedFiles, ...task.filesTouched].map((file) => this.normalize(file)).filter(Boolean))];
    const locks = filesToLock.map((filePath) => ({
      filePath,
      taskId: task.id,
      lockedAt: Date.now()
    }));

    for (const lock of locks) {
      this.locks.set(lock.filePath, lock);
    }

    return locks;
  }

  public releaseTask(taskId: string): void {
    for (const [filePath, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        this.locks.delete(filePath);
      }
    }
  }

  private normalize(filePath: string): string {
    return filePath.trim().replace(/\\/g, "/");
  }
}
