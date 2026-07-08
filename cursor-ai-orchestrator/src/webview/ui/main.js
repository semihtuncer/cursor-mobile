const vscode = acquireVsCodeApi();

let snapshot = { tasks: [], locks: [] };

const promptInput = document.getElementById("prompt-input");
const submitButton = document.getElementById("submit-button");
const clearCompletedButton = document.getElementById("clear-completed-button");
const activeTasks = document.getElementById("active-tasks");
const queuedTasks = document.getElementById("queued-tasks");
const completedTasks = document.getElementById("completed-tasks");
const failedTasks = document.getElementById("failed-tasks");
const locks = document.getElementById("locks");
const taskCountPill = document.getElementById("task-count-pill");
const activeCount = document.getElementById("active-count");
const queuedCount = document.getElementById("queued-count");
const completedCount = document.getElementById("completed-count");
const failedCount = document.getElementById("failed-count");
const lockCount = document.getElementById("lock-count");

submitButton.addEventListener("click", submitPrompt);
clearCompletedButton.addEventListener("click", () => vscode.postMessage({ type: "clearCompleted" }));
promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    submitPrompt();
  }
});

window.addEventListener("message", (event) => {
  if (event.data.type !== "state") {
    return;
  }

  snapshot = event.data.snapshot;
  render();
});

vscode.postMessage({ type: "ready" });

function submitPrompt() {
  const text = promptInput.value.trim();
  if (!text) {
    return;
  }

  vscode.postMessage({ type: "submitPrompt", text });
  promptInput.value = "";
}

function render() {
  const running = snapshot.tasks.filter((task) => ["running", "paused"].includes(task.status));
  const queued = snapshot.tasks.filter((task) => task.status === "queued");
  const completed = snapshot.tasks.filter((task) => task.status === "completed");
  const failed = snapshot.tasks.filter((task) => ["failed", "blocked"].includes(task.status));

  taskCountPill.textContent = String(snapshot.tasks.length);
  activeCount.textContent = String(running.length);
  queuedCount.textContent = String(queued.length);
  completedCount.textContent = String(completed.length);
  failedCount.textContent = String(failed.length);
  lockCount.textContent = String(snapshot.locks.length);

  renderLocks();
  renderTaskList(activeTasks, running, "No active chats.");
  renderTaskList(queuedTasks, queued, "Queue is empty.");
  renderTaskList(completedTasks, completed, "No completed chats.");
  renderTaskList(failedTasks, failed, "Nothing needs attention.");
}

function renderLocks() {
  locks.innerHTML = "";
  if (snapshot.locks.length === 0) {
    locks.appendChild(empty("No files locked."));
    return;
  }

  for (const lock of snapshot.locks) {
    const row = document.createElement("div");
    row.className = "lock-banner";

    const icon = document.createElement("span");
    icon.className = "lock-icon";
    icon.textContent = "▣";

    const text = document.createElement("span");
    text.textContent = lock.filePath;

    const owner = document.createElement("span");
    owner.className = "lock-owner";
    owner.textContent = shortId(lock.taskId);

    row.append(icon, text, owner);
    locks.appendChild(row);
  }
}

function renderTaskList(container, tasks, emptyText) {
  container.innerHTML = "";
  if (tasks.length === 0) {
    container.appendChild(empty(emptyText));
    return;
  }

  for (const task of tasks) {
    container.appendChild(taskCard(task));
  }
}

function taskCard(task) {
  const card = document.createElement("article");
  card.className = `task-banner status-${task.status}`;

  const header = document.createElement("div");
  header.className = "banner-main";

  const statusDot = document.createElement("span");
  statusDot.className = "status-dot";

  const title = document.createElement("h3");
  title.textContent = task.title;

  const titleWrap = document.createElement("div");
  titleWrap.className = "banner-copy";
  titleWrap.append(title, bannerSummary(task));

  const status = document.createElement("span");
  status.className = "status-pill";
  status.textContent = task.status;

  header.append(statusDot, titleWrap, status);
  card.appendChild(header);

  const chips = document.createElement("div");
  chips.className = "banner-chips";
  chips.append(
    chip(`conf ${confidenceFromSummary(task.summary)}`),
    chip(`${task.queue.length} queued`),
    chip(formatList(task.featureAreas, "no area"))
  );
  card.appendChild(chips);

  const files = compactFiles(task);
  if (files) {
    const fileLine = document.createElement("div");
    fileLine.className = "file-line";
    fileLine.textContent = files;
    card.appendChild(fileLine);
  }

  if (task.queue.length > 0) {
    const queue = document.createElement("div");
    queue.className = "prompt-batch";
    const label = document.createElement("strong");
    label.textContent = "Queued chat prompts";
    queue.appendChild(label);
    for (const prompt of task.queue) {
      queue.appendChild(queuePromptRow(task, prompt));
    }
    card.appendChild(queue);
  }

  const actions = document.createElement("div");
  actions.className = "task-actions";
  if (task.status === "running") {
    actions.appendChild(actionButton("Pause", () => vscode.postMessage({ type: "pauseTask", taskId: task.id })));
  }
  if (task.status === "paused") {
    actions.appendChild(actionButton("Resume", () => vscode.postMessage({ type: "resumeTask", taskId: task.id })));
  }
  if (!["completed", "failed"].includes(task.status)) {
    actions.appendChild(actionButton("Cancel", () => vscode.postMessage({ type: "cancelTask", taskId: task.id }), "danger"));
  }
  card.appendChild(actions);

  return card;
}

function queuePromptRow(task, prompt) {
  const row = document.createElement("div");
  row.className = "prompt-banner";

  const text = document.createElement("span");
  text.textContent = prompt.text;
  row.appendChild(text);

  const targets = snapshot.tasks.filter((candidate) => candidate.id !== task.id && !["completed", "failed"].includes(candidate.status));
  if (targets.length > 0) {
    const select = document.createElement("select");
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = target.title;
      select.appendChild(option);
    }

    const move = actionButton("Move", () =>
      vscode.postMessage({
        type: "reassignPrompt",
        promptId: prompt.id,
        fromTaskId: task.id,
        toTaskId: select.value
      })
    );
    row.append(select, move);
  }

  return row;
}

function metaRow(label, value) {
  const row = document.createElement("div");
  row.className = "meta-row";

  const key = document.createElement("span");
  key.className = "meta-key";
  key.textContent = label;

  const val = document.createElement("span");
  val.className = "meta-value";
  val.textContent = value || "-";

  row.append(key, val);
  return row;
}

function actionButton(label, handler, variant = "secondary") {
  const button = document.createElement("button");
  button.className = variant;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function chip(text) {
  const element = document.createElement("span");
  element.className = "chip";
  element.textContent = text;
  return element;
}

function empty(text) {
  const element = document.createElement("p");
  element.className = "empty";
  element.textContent = text;
  return element;
}

function formatList(values, fallback = "-") {
  return values.length > 0 ? values.join(", ") : fallback;
}

function latestSummary(summary) {
  return summary.split("\n").filter(Boolean).slice(-2).join(" ");
}

function bannerSummary(task) {
  const summary = document.createElement("p");
  summary.textContent = latestSummary(task.summary);
  return summary;
}

function compactFiles(task) {
  const files = [...new Set([...task.filesTouched, ...task.predictedFiles])];
  if (files.length === 0) {
    return "";
  }

  const visible = files.slice(0, 2).join(", ");
  const overflow = files.length > 2 ? ` +${files.length - 2}` : "";
  return visible + overflow;
}

function confidenceFromSummary(summary) {
  const match = summary.match(/Routing confidence:\s*([0-9.]+)/);
  return match ? match[1] : "see routing log";
}

function shortId(id) {
  return id.slice(0, 8);
}
