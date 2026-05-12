import "./styles/app.css";
import type { AgentEvent, ChatGptAuthStatus, ChatGptLoginStart, ChatGptUsage, PublicUser, SavedRoom } from "../shared/api";
import { modelOptions } from "../shared/models";
import type { RoomConfig } from "../shared/room";
import { roomConfig } from "../../sandbox/rooms/active/roomConfig";
import * as activeRoomScene from "../../sandbox/rooms/active/activeRoomScene";
import { RoomRenderer, type CameraPose } from "./room/RoomRenderer";
import type { RoomSceneModule } from "./room/sceneTypes";

const app = document.querySelector<HTMLDivElement>("#app")!;
const sessionStateKey = "roomscape.session.v1";
const initialStoredSession = loadStoredSession();
const activeRoomSceneImporters = import.meta.glob("../../sandbox/rooms/active/activeRoomScene.ts");

interface ClientState {
  user: PublicUser | null;
  config: RoomConfig;
  logs: string[];
  totalCost: number;
  promptRuns: number;
  chatGptUsage: string | null;
  rooms: SavedRoom[];
  activeRunIds: string[];
  isWorking: boolean;
}

const state: ClientState = {
  user: null,
  config: roomConfig,
  logs: initialStoredSession.logs,
  totalCost: 0,
  promptRuns: initialStoredSession.promptRuns,
  chatGptUsage: null,
  rooms: [],
  activeRunIds: initialStoredSession.activeRunIds,
  isWorking: initialStoredSession.isWorking,
};

let renderer: RoomRenderer | null = null;
let chatGptPoll: number | undefined;
let usagePoll: number | undefined;
let posePoll: number | undefined;
let activityPoll: number | undefined;
const activeSources = new Map<string, EventSource>();
let chatGptAuthWindow: WindowProxy | null = null;
let activeRunStartedAt: number | null = initialStoredSession.activeRunStartedAt;
let activeRunLastEventAt: number | null = initialStoredSession.activeRunLastEventAt;
let activeRunModel: string | null = initialStoredSession.activeRunModel;
const seenAgentEventKeys = new Set(initialStoredSession.seenAgentEventKeys);

window.addEventListener("beforeunload", persistSessionState);

void boot();

async function boot() {
  const session = await api<{ user: PublicUser | null }>("/api/session");
  state.user = session.user;
  if (state.user) {
    await loadRooms();
    renderWorkspace();
  } else {
    renderLanding();
  }
}

function renderLanding() {
  clearPolling();
  closeActiveSources();
  persistSessionState();
  stopPosePersistence();
  renderer?.dispose();
  app.innerHTML = `
    <main class="landing-shell">
      <div class="landing-door-scene" aria-hidden="true">
        <div class="door-glow"></div>
        <div class="floor-light"></div>
        <div class="door-frame">
          <span class="door-knob"></span>
        </div>
      </div>
      <section class="landing-title" aria-labelledby="landing-heading">
        <h1 id="landing-heading">Roomscape</h1>
        <p class="tagline">Exploring the world while building it.</p>
        <button id="chatgpt-login" type="button">Sign in with ChatGPT</button>
        <p id="auth-error" class="form-error" hidden></p>
      </section>
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#chatgpt-login")!.addEventListener("click", startChatGptAuth);
}

async function startChatGptAuth() {
  const button = document.querySelector<HTMLButtonElement>("#chatgpt-login")!;
  const errorTarget = document.querySelector<HTMLElement>("#auth-error")!;
  chatGptAuthWindow = window.open("about:blank", "roomscape-chatgpt-login", "popup,width=520,height=720");
  if (!chatGptAuthWindow) {
    button.disabled = true;
    button.textContent = "Checking ChatGPT...";
    errorTarget.textContent = "";
    errorTarget.hidden = true;
    const authenticated = await authenticateExistingChatGptSession();
    if (!authenticated) {
      button.disabled = false;
      button.textContent = "Sign in with ChatGPT";
      errorTarget.textContent = "Unable to open ChatGPT sign-in. Allow pop-ups for Roomscape and try again.";
      errorTarget.hidden = false;
    }
    return;
  }
  clearPolling();
  button.disabled = true;
  errorTarget.textContent = "";
  errorTarget.hidden = true;
  try {
    const login = await api<ChatGptLoginStart>("/api/auth/chatgpt/start", { method: "POST" });
    if (login.type === "chatgptDeviceCode") {
      chatGptAuthWindow.location.href = login.verificationUrl;
      errorTarget.textContent = `Enter code ${login.userCode} on the OpenAI page. If ChatGPT asks, enable Codex device code authorization in ChatGPT Security Settings, then retry sign-in.`;
      errorTarget.hidden = false;
      button.textContent = "Waiting for ChatGPT...";
    } else {
      chatGptAuthWindow.location.href = login.authUrl;
      button.textContent = "Waiting for ChatGPT...";
    }
    chatGptPoll = window.setInterval(() => void completeChatGptAuth(login.loginId, true), 2_500);
  } catch (error) {
    chatGptAuthWindow?.close();
    chatGptAuthWindow = null;
    button.disabled = false;
    button.textContent = "Sign in with ChatGPT";
    errorTarget.textContent = error instanceof Error ? error.message : "Unable to start ChatGPT login.";
    errorTarget.hidden = false;
  }
}

async function authenticateExistingChatGptSession(): Promise<boolean> {
  try {
    const result = await api<ChatGptAuthStatus>("/api/auth/chatgpt/existing", { method: "POST" });
    if (result.status !== "authenticated" || !result.user) return false;
    clearPolling();
    chatGptAuthWindow?.close();
    chatGptAuthWindow = null;
    state.user = result.user;
    const errorTarget = document.querySelector<HTMLElement>("#auth-error");
    if (errorTarget) errorTarget.hidden = true;
    await loadRooms();
    renderWorkspace();
    return true;
  } catch {
    return false;
  }
}

async function completeChatGptAuth(loginId: string, quiet = false) {
  const button = document.querySelector<HTMLButtonElement>("#chatgpt-login");
  if (!quiet && button) button.textContent = "Checking ChatGPT...";
  try {
    const result = await api<ChatGptAuthStatus>("/api/auth/chatgpt/complete", { method: "POST", body: { loginId } });
    if (result.status !== "authenticated" || !result.user) {
      if (!quiet && button) button.textContent = "Waiting for ChatGPT...";
      return;
    }
    clearPolling();
    chatGptAuthWindow?.close();
    chatGptAuthWindow = null;
    state.user = result.user;
    await loadRooms();
    renderWorkspace();
  } catch (error) {
    clearPolling();
    const errorTarget = document.querySelector<HTMLElement>("#auth-error");
    if (errorTarget) {
      errorTarget.textContent = error instanceof Error ? error.message : "Unable to complete ChatGPT login.";
      errorTarget.hidden = false;
    }
    const button = document.querySelector<HTMLButtonElement>("#chatgpt-login");
    if (button) {
      button.disabled = false;
      button.textContent = "Sign in with ChatGPT";
    }
  }
}

function renderWorkspace() {
  clearPolling();
  persistSessionState();
  stopPosePersistence();
  app.innerHTML = `
    <main class="workspace">
      <div id="room-canvas" class="room-canvas"></div>
      <aside class="overlay">
        <div class="identity">
          <div>
            <span>${escapeHtml(accountLabel())}</span>
            <strong>Roomscape</strong>
          </div>
          <button id="logout" class="quiet-button" type="button">Sign out</button>
        </div>
        <form id="prompt-form" class="prompt-form">
          <select id="model-select" name="model" ${state.isWorking ? "disabled" : ""}>
            ${modelOptions.map((model) => `<option value="${model.id}" ${model.id === selectedModelId() ? "selected" : ""}>${model.label}</option>`).join("")}
          </select>
          <textarea id="prompt-input" name="prompt" rows="4" placeholder="Describe the exact room change." required ${state.isWorking ? "disabled" : ""}></textarea>
          <div class="prompt-actions">
            <button id="build-button" type="submit" ${state.isWorking ? "disabled" : ""}>Build</button>
            <button id="cancel-edit" class="quiet-button danger-button" type="button" ${state.isWorking ? "" : "hidden"}>Cancel</button>
          </div>
        </form>
        <div class="actions">
          <input id="room-name" aria-label="Room name" value="${escapeHtml(state.config.name)}" />
          <button id="save-room" type="button">Save</button>
          <button id="reset-room" class="quiet-button" type="button">Reset</button>
        </div>
        <select id="room-loader" aria-label="Load saved room">
          <option value="">Load saved room</option>
          ${state.rooms.map((room) => `<option value="${room.id}">${escapeHtml(room.name)}</option>`).join("")}
        </select>
        <div class="telemetry">
          <div class="usage-row">
            <span>Session usage</span>
            <strong id="usage">${escapeHtml(sessionUsageLabel())}</strong>
          </div>
          <div id="logs" class="log-panel" role="log" aria-live="polite">${renderLogContent()}</div>
        </div>
      </aside>
    </main>
  `;

  wireWorkspaceEvents();
  renderer?.dispose();
  renderer = new RoomRenderer(document.querySelector("#room-canvas")!);
  applyActiveScene();
  renderer.start();
  restoreStoredPose();
  startPosePersistence();
  startUsagePolling();
  reconnectActiveRun();
}

function wireWorkspaceEvents() {
  document.querySelector<HTMLFormElement>("#prompt-form")!.addEventListener("submit", submitPrompt);
  document.querySelector<HTMLButtonElement>("#cancel-edit")!.addEventListener("click", cancelRoomEdit);
  document.querySelector<HTMLButtonElement>("#save-room")!.addEventListener("click", saveRoom);
  document.querySelector<HTMLButtonElement>("#reset-room")!.addEventListener("click", resetRoom);
  document.querySelector<HTMLSelectElement>("#room-loader")!.addEventListener("change", loadRoomSelection);
  document.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", logout);
}

function applyActiveScene() {
  applySceneModule(activeRoomScene);
}

function applySceneModule(module: RoomSceneModule) {
  if (!renderer) return;
  try {
    renderer.applyScene(module);
  } catch (error) {
    pushLog(`ERROR: Generated scene failed to render: ${error instanceof Error ? error.message : "Unknown scene error."}`);
    renderer.applyScene(fallbackRoomScene);
    updateTelemetry();
  }
}

async function applyLatestActiveScene() {
  try {
    const importActiveRoomScene = activeRoomSceneImporters["../../sandbox/rooms/active/activeRoomScene.ts"];
    if (!importActiveRoomScene) throw new Error("Active room scene importer is unavailable.");
    const module = await importActiveRoomScene();
    applySceneModule(module as unknown as RoomSceneModule);
  } catch (error) {
    pushLog(`ERROR: Unable to load active scene: ${error instanceof Error ? error.message : "Unknown scene load error."}`);
    applyActiveScene();
    updateTelemetry();
  }
}

async function applyLatestActiveScenePreservingPose() {
  const pose = renderer?.pose();
  await applyLatestActiveScene();
  if (pose) renderer?.restorePose(pose);
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    clearPolling();
    renderer?.dispose();
    renderer = null;
    state.user = null;
    state.config = roomConfig;
    state.logs = [];
    state.totalCost = 0;
    state.promptRuns = 0;
    state.chatGptUsage = null;
    state.rooms = [];
    state.activeRunIds = [];
    state.isWorking = false;
    clearActiveRunStatus();
    seenAgentEventKeys.clear();
    closeActiveSources();
    clearStoredSession();
    renderLanding();
  }
}

const fallbackRoomScene: RoomSceneModule = {
  roomTitle: "Scene recovery room",
  buildRoom({ THREE, root, scene }) {
    scene.background = new THREE.Color("#f1eee8");
    scene.fog = null;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: "#8a8479", roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: "#f1eee8", roughness: 1 }),
    );
    ceiling.position.y = 3;
    ceiling.rotation.x = Math.PI / 2;
    root.add(ceiling);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: "#d7d2c8", roughness: 1 });
    const wallGeometry = new THREE.PlaneGeometry(10, 3);
    const walls: Array<[number, number, number, number]> = [
      [0, 1.5, -5, 0],
      [0, 1.5, 5, Math.PI],
      [-5, 1.5, 0, Math.PI / 2],
      [5, 1.5, 0, -Math.PI / 2],
    ];
    for (const [x, y, z, rotationY] of walls) {
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(x, y, z);
      wall.rotation.y = rotationY;
      root.add(wall);
    }
    root.add(new THREE.HemisphereLight("#ffffff", "#555555", 1.2));
  },
};

async function submitPrompt(event: SubmitEvent) {
  event.preventDefault();
  if (state.isWorking) {
    pushLog("Cancel the active edit before starting a new one.");
    updateTelemetry();
    return;
  }
  const form = event.currentTarget as HTMLFormElement;
  const values = Object.fromEntries(new FormData(form).entries());
  const prompt = String(values.prompt ?? "").trim();
  if (!prompt) return;
  state.isWorking = true;
  activeRunStartedAt = Date.now();
  activeRunLastEventAt = activeRunStartedAt;
  activeRunModel = String(values.model ?? "");
  persistSessionState();
  updateTelemetry();
  try {
    const result = await api<{ runId: string }>("/api/agent/runs", {
      method: "POST",
      body: { prompt, model: values.model, currentConfig: state.config },
    });
    state.activeRunIds = [...state.activeRunIds, result.runId];
    persistSessionState();
    streamRun(result.runId);
    const promptInput = form.querySelector<HTMLTextAreaElement>("#prompt-input");
    if (promptInput) promptInput.value = "";
  } catch (error) {
    state.isWorking = false;
    clearActiveRunStatus();
    pushLog(`ERROR: ${error instanceof Error ? error.message : "Unable to start room edit."}`);
  } finally {
    updateTelemetry();
    persistSessionState();
  }
}

async function cancelRoomEdit() {
  if (!state.isWorking && state.activeRunIds.length === 0) return;
  try {
    await api("/api/agent/runs/cancel", { method: "POST" });
  } catch (error) {
    pushLog(`ERROR: ${error instanceof Error ? error.message : "Unable to cancel room edit."}`);
  } finally {
    closeActiveSources();
    state.activeRunIds = [];
    state.isWorking = false;
    clearActiveRunStatus();
    pushLog("Room edit cancelled.");
    updateTelemetry();
    persistSessionState();
  }
}

function streamRun(runId: string) {
  if (activeSources.has(runId)) return;
  const source = new EventSource(`/api/agent/runs/${runId}/events`);
  activeSources.set(runId, source);
  source.onmessage = (message) => {
    const event = parseAgentEvent(message);
    if (event) handleAgentEvent(event, runId);
  };
  for (const eventName of ["log", "cost", "room-updated", "scene-updated", "permission-request", "complete", "error"]) {
    source.addEventListener(eventName, (message) => {
      const event = parseAgentEvent(message as MessageEvent);
      if (!event) return;
      handleAgentEvent(event, runId);
      if (event.type === "complete" || event.type === "permission-request" || event.type === "error") {
        source.close();
        activeSources.delete(runId);
        state.activeRunIds = state.activeRunIds.filter((id) => id !== runId);
        state.isWorking = activeSources.size > 0 || state.activeRunIds.length > 0;
        if (!state.isWorking) clearActiveRunStatus();
        updateTelemetry();
        persistSessionState();
      }
    });
  }
}

function parseAgentEvent(message: MessageEvent): AgentEvent | null {
  if (typeof message.data !== "string" || !message.data) return null;
  try {
    return JSON.parse(message.data) as AgentEvent;
  } catch {
    return null;
  }
}

function handleAgentEvent(event: AgentEvent, runId?: string) {
  if (rememberAgentEvent(event, runId)) return;
  activeRunLastEventAt = Date.now();
  if (event.type === "log") pushLog(event.message);
  if (event.type === "cost") state.totalCost += event.usd;
  if (event.type === "permission-request") pushLog(`PERMISSION REQUIRED: ${event.request.reason} -> ${event.request.requestedPath}`);
  if (event.type === "error") pushLog(`ERROR: ${event.message}`);
  if (event.type === "complete" && runId) pushLog(`Run complete: ${runId.slice(0, 8)}.`);
  if (event.type === "room-updated") {
    state.promptRuns += 1;
    const pose = renderer?.pose();
    state.config = event.config;
    renderer?.applyConfig(event.config);
    if (pose) renderer?.restorePose(pose);
    const roomName = document.querySelector<HTMLInputElement>("#room-name");
    if (roomName && roomName.value === "Bare Room") {
      roomName.value = event.config.name;
    }
  }
  if (event.type === "scene-updated") {
    state.promptRuns += 1;
    pushLog("Scene module updated.");
    void applyLatestActiveScenePreservingPose();
  }
  updateTelemetry();
  persistSessionState();
}

function rememberAgentEvent(event: AgentEvent, runId?: string): boolean {
  const key = `${runId ?? "run"}:${event.type}:${event.at}:${JSON.stringify(event)}`;
  if (seenAgentEventKeys.has(key)) return true;
  seenAgentEventKeys.add(key);
  while (seenAgentEventKeys.size > 300) {
    const first = seenAgentEventKeys.values().next().value;
    if (!first) break;
    seenAgentEventKeys.delete(first);
  }
  return false;
}

async function saveRoom() {
  const name = document.querySelector<HTMLInputElement>("#room-name")!.value;
  await api("/api/rooms", { method: "POST", body: { name } });
  await loadRooms();
  renderWorkspace();
}

async function resetRoom() {
  const result = await api<{ config: RoomConfig }>("/api/active-room/reset", { method: "POST" });
  state.config = result.config;
  state.logs = [];
  state.promptRuns = 0;
  state.activeRunIds = [];
  state.isWorking = false;
  clearActiveRunStatus();
  seenAgentEventKeys.clear();
  closeActiveSources();
  await applyLatestActiveScene();
  const roomName = document.querySelector<HTMLInputElement>("#room-name");
  if (roomName) roomName.value = result.config.name;
  updateTelemetry();
}

async function loadRooms() {
  const result = await api<{ rooms: SavedRoom[] }>("/api/rooms");
  state.rooms = result.rooms;
}

async function loadRoomSelection(event: Event) {
  const id = (event.currentTarget as HTMLSelectElement).value;
  if (!id) return;
  const result = await api<{ room: SavedRoom }>(`/api/rooms/${id}`);
  state.config = { ...result.room.config, name: result.room.name };
  pushLog(`Loaded ${result.room.name}.`);
  renderWorkspace();
  await applyLatestActiveScenePreservingPose();
}

function updateTelemetry() {
  document.querySelector("#usage")!.textContent = sessionUsageLabel();
  const logs = document.querySelector<HTMLElement>("#logs");
  if (logs) {
    logs.innerHTML = renderLogContent();
    logs.scrollTop = logs.scrollHeight;
  }
  updatePromptControls();
  syncActivityPolling();
}

function renderLogContent(): string {
  const entries = state.logs.length > 0
    ? state.logs.map((entry) => `<div class="log-line">${escapeHtml(entry)}</div>`).join("")
    : '<div class="log-line log-muted">No room edits yet.</div>';
  const activity = state.isWorking ? renderRunActivity() : "";
  return entries + activity;
}

function renderRunActivity(): string {
  const now = Date.now();
  const startedAt = activeRunStartedAt ?? now;
  const lastEventAt = activeRunLastEventAt ?? startedAt;
  const elapsed = Math.max(0, now - startedAt);
  const idle = Math.max(0, now - lastEventAt);
  const model = modelLabel(activeRunModel);
  const staleClass = idle >= 60_000 ? " log-activity-stale" : "";
  const stale = idle >= 60_000
    ? `<div class="log-line log-muted">No new model event for ${formatDuration(idle)}.</div>`
    : "";
  return [
    `<div class="log-line log-activity${staleClass}"><span class="log-spinner" aria-hidden="true"></span><span>${escapeHtml(model)} working for ${formatDuration(elapsed)}<span class="log-ellipsis" aria-hidden="true"></span></span></div>`,
    stale,
  ].join("");
}

function updatePromptControls() {
  const prompt = document.querySelector<HTMLTextAreaElement>("#prompt-input");
  const model = document.querySelector<HTMLSelectElement>("#model-select");
  const build = document.querySelector<HTMLButtonElement>("#build-button");
  const cancel = document.querySelector<HTMLButtonElement>("#cancel-edit");
  if (prompt) prompt.disabled = state.isWorking;
  if (model) model.disabled = state.isWorking;
  if (build) build.disabled = state.isWorking;
  if (cancel) cancel.hidden = !state.isWorking;
}

function syncActivityPolling(): void {
  if (state.isWorking && !activityPoll) {
    activityPoll = window.setInterval(updateTelemetry, 1000);
  }
  if (!state.isWorking && activityPoll) {
    window.clearInterval(activityPoll);
    activityPoll = undefined;
  }
}

function selectedModelId(): string {
  return activeRunModel ?? modelOptions[0]!.id;
}

function modelLabel(modelId: string | null): string {
  return modelOptions.find((model) => model.id === modelId)?.label ?? "Model";
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function pushLog(message: string): void {
  if (state.logs.at(-1) === message) return;
  state.logs.push(message);
}

function clearActiveRunStatus(): void {
  activeRunStartedAt = null;
  activeRunLastEventAt = null;
  activeRunModel = null;
}

function accountLabel(): string {
  if (!state.user) return "OpenAI connected";
  if (state.user.authMode === "chatgpt") {
    return state.user.planType ? `ChatGPT ${state.user.planType}` : "ChatGPT account";
  }
  return state.user.accountLabel;
}

function sessionUsageLabel(): string {
  if (state.user?.authMode === "chatgpt") {
    const plan = state.user.planType ? `${state.user.planType} plan` : "ChatGPT";
    return `${state.promptRuns} runs | ${state.chatGptUsage ?? plan}`;
  }
  return `${state.promptRuns} runs | $${state.totalCost.toFixed(4)}`;
}

function startUsagePolling() {
  if (state.user?.authMode !== "chatgpt") return;
  void refreshUsage();
  usagePoll = window.setInterval(() => void refreshUsage(), 30_000);
}

async function refreshUsage() {
  try {
    const result = await api<{ usage: ChatGptUsage | null }>("/api/usage");
    state.chatGptUsage = result.usage ? formatChatGptUsage(result.usage) : null;
    updateTelemetry();
  } catch {
    state.chatGptUsage = "usage unavailable";
    updateTelemetry();
  }
}

function formatChatGptUsage(usage: ChatGptUsage): string {
  const bucket = usage.rateLimits ?? Object.values(usage.rateLimitsByLimitId ?? {})[0];
  if (!bucket?.primary) return "ChatGPT usage active";
  return `${bucket.primary.usedPercent}% of ${bucket.limitName ?? bucket.limitId} window`;
}

function clearPolling() {
  if (chatGptPoll) window.clearInterval(chatGptPoll);
  if (usagePoll) window.clearInterval(usagePoll);
  if (activityPoll) window.clearInterval(activityPoll);
  chatGptPoll = undefined;
  usagePoll = undefined;
  activityPoll = undefined;
}

function reconnectActiveRun(): void {
  for (const runId of state.activeRunIds) streamRun(runId);
  state.isWorking = state.activeRunIds.length > 0;
  if (!state.isWorking) clearActiveRunStatus();
  updateTelemetry();
}

function closeActiveSources(): void {
  for (const source of activeSources.values()) source.close();
  activeSources.clear();
}

function startPosePersistence(): void {
  posePoll = window.setInterval(persistSessionState, 300);
}

function stopPosePersistence(): void {
  if (posePoll) window.clearInterval(posePoll);
  posePoll = undefined;
}

function restoreStoredPose(): void {
  const pose = loadStoredSession().pose;
  if (pose) renderer?.restorePose(pose);
}

interface StoredSession {
  logs: string[];
  promptRuns: number;
  activeRunIds: string[];
  isWorking: boolean;
  activeRunStartedAt: number | null;
  activeRunLastEventAt: number | null;
  activeRunModel: string | null;
  seenAgentEventKeys: string[];
  pose: CameraPose | null;
}

function loadStoredSession(): StoredSession {
  try {
    const raw = sessionStorage.getItem(sessionStateKey);
    if (!raw) return emptyStoredSession();
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    return {
      logs: Array.isArray(parsed.logs) ? parsed.logs.filter((entry): entry is string => typeof entry === "string") : [],
      promptRuns: typeof parsed.promptRuns === "number" ? parsed.promptRuns : 0,
      activeRunIds: Array.isArray(parsed.activeRunIds)
        ? parsed.activeRunIds.filter((entry): entry is string => typeof entry === "string")
        : typeof (parsed as { activeRunId?: unknown }).activeRunId === "string"
          ? [(parsed as { activeRunId: string }).activeRunId]
          : [],
      isWorking: Boolean(parsed.isWorking),
      activeRunStartedAt: typeof parsed.activeRunStartedAt === "number" ? parsed.activeRunStartedAt : null,
      activeRunLastEventAt: typeof parsed.activeRunLastEventAt === "number" ? parsed.activeRunLastEventAt : null,
      activeRunModel: typeof parsed.activeRunModel === "string" ? parsed.activeRunModel : null,
      seenAgentEventKeys: Array.isArray(parsed.seenAgentEventKeys)
        ? parsed.seenAgentEventKeys.filter((entry): entry is string => typeof entry === "string")
        : [],
      pose: isCameraPose(parsed.pose) ? parsed.pose : null,
    };
  } catch {
    return emptyStoredSession();
  }
}

function persistSessionState(): void {
  try {
    const payload: StoredSession = {
      logs: state.logs,
      promptRuns: state.promptRuns,
      activeRunIds: state.activeRunIds,
      isWorking: state.isWorking,
      activeRunStartedAt,
      activeRunLastEventAt,
      activeRunModel,
      seenAgentEventKeys: [...seenAgentEventKeys],
      pose: renderer?.pose() ?? loadStoredSession().pose,
    };
    sessionStorage.setItem(sessionStateKey, JSON.stringify(payload));
  } catch {
    // Session persistence is best-effort; rendering should continue if storage is unavailable.
  }
}

function clearStoredSession(): void {
  sessionStorage.removeItem(sessionStateKey);
}

function emptyStoredSession(): StoredSession {
  return {
    logs: [],
    promptRuns: 0,
    activeRunIds: [],
    isWorking: false,
    activeRunStartedAt: null,
    activeRunLastEventAt: null,
    activeRunModel: null,
    seenAgentEventKeys: [],
    pose: null,
  };
}

function isCameraPose(value: unknown): value is CameraPose {
  if (!value || typeof value !== "object") return false;
  const pose = value as CameraPose;
  return isVector3(pose.position) && isVector3(pose.rotation);
}

function isVector3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number");
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "same-origin",
    ...(options.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) } : {}),
  };
  const response = await fetch(path, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload as T;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

if (import.meta.hot) {
  import.meta.hot.accept("../../sandbox/rooms/active/roomConfig", (module) => {
    if (!module?.roomConfig) return;
    const pose = renderer?.pose();
    state.config = module.roomConfig;
    renderer?.applyConfig(module.roomConfig);
    if (pose) renderer?.restorePose(pose);
  });
  import.meta.hot.accept("../../sandbox/rooms/active/activeRoomScene", (module) => {
    if (!module?.buildRoom) return;
    const pose = renderer?.pose();
    renderer?.applyScene(module as unknown as RoomSceneModule);
    if (pose) renderer?.restorePose(pose);
  });
}
