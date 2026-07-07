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

  renderLocks();
  renderTaskList(activeTasks, running, "No active tasks.");
  renderTaskList(queuedTasks, queued, "No queued tasks.");
  renderTaskList(completedTasks, completed, "No completed tasks.");
  renderTaskList(failedTasks, failed, "No failed or blocked tasks.");
}

function renderLocks() {
  locks.innerHTML = "";
  if (snapshot.locks.length === 0) {
    locks.appendChild(empty("No files locked."));
    return;
  }

  for (const lock of snapshot.locks) {
    const row = document.createElement("div");
    row.className = "lock-row";
    row.textContent = `${lock.filePath} -> ${shortId(lock.taskId)}`;
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
  card.className = `task-card status-${task.status}`;

  const header = document.createElement("div");
  header.className = "task-header";

  const title = document.createElement("h3");
  title.textContent = task.title;

  const status = document.createElement("span");
  status.className = "status-pill";
  status.textContent = task.status;

  header.append(title, status);
  card.appendChild(header);

  card.appendChild(metaRow("Confidence", confidenceFromSummary(task.summary)));
  card.appendChild(metaRow("Queue length", String(task.queue.length)));
  card.appendChild(metaRow("Files touched", formatList(task.filesTouched)));
  card.appendChild(metaRow("Predicted files", formatList(task.predictedFiles)));
  card.appendChild(metaRow("Areas", formatList(task.featureAreas)));
  card.appendChild(metaRow("Latest summary", latestSummary(task.summary)));

  if (task.queue.length > 0) {
    const queue = document.createElement("div");
    queue.className = "queue-items";
    const label = document.createElement("strong");
    label.textContent = "Queued prompts";
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
  row.className = "queue-prompt";

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

function empty(text) {
  const element = document.createElement("p");
  element.className = "empty";
  element.textContent = text;
  return element;
}

function formatList(values) {
  return values.length > 0 ? values.join(", ") : "-";
}

function latestSummary(summary) {
  return summary.split("\n").filter(Boolean).slice(-2).join(" ");
}

function confidenceFromSummary(summary) {
  const match = summary.match(/Routing confidence:\s*([0-9.]+)/);
  return match ? match[1] : "see routing log";
}

function shortId(id) {
  return id.slice(0, 8);
}
