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

interface ClientState {
  user: PublicUser | null;
  config: RoomConfig;
  logs: string[];
  totalCost: number;
  promptRuns: number;
  chatGptUsage: string | null;
  rooms: SavedRoom[];
  activeRunId: string | null;
  isWorking: boolean;
}

const state: ClientState = {
  user: null,
  config: roomConfig,
  logs: loadStoredSession().logs,
  totalCost: 0,
  promptRuns: loadStoredSession().promptRuns,
  chatGptUsage: null,
  rooms: [],
  activeRunId: loadStoredSession().activeRunId,
  isWorking: loadStoredSession().isWorking,
};

let renderer: RoomRenderer | null = null;
let chatGptPoll: number | undefined;
let usagePoll: number | undefined;
let posePoll: number | undefined;
let activeSource: EventSource | null = null;
let chatGptAuthWindow: WindowProxy | null = null;

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
  activeSource?.close();
  activeSource = null;
  persistSessionState();
  stopPosePersistence();
  renderer?.dispose();
  app.innerHTML = `
    <main class="landing-shell">
      <section class="landing-title">
        <h1>Roomscape</h1>
        <p class="tagline">Explore the world while building it.</p>
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
    errorTarget.textContent = "Unable to open ChatGPT sign-in. Allow pop-ups for Roomscape and try again.";
    errorTarget.hidden = false;
    return;
  }
  clearPolling();
  button.disabled = true;
  errorTarget.textContent = "";
  errorTarget.hidden = true;
  try {
    const login = await api<ChatGptLoginStart>("/api/auth/chatgpt/start", { method: "POST" });
    chatGptAuthWindow.location.href = login.authUrl;
    button.textContent = "Waiting for ChatGPT...";
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
          <select name="model">
            ${modelOptions.map((model) => `<option value="${model.id}">${model.label}</option>`).join("")}
          </select>
          <textarea name="prompt" rows="4" placeholder="Describe the exact room change." required></textarea>
          <button type="submit">Build</button>
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
            <span id="working-indicator" class="working-indicator" ${state.isWorking ? "" : "hidden"}><span></span>Working</span>
          </div>
          <pre id="logs">${state.logs.map(escapeHtml).join("\n")}</pre>
        </div>
      </aside>
    </main>
  `;

  renderer?.dispose();
  renderer = new RoomRenderer(document.querySelector("#room-canvas")!);
  renderer.applyScene(activeRoomScene);
  renderer.start();
  restoreStoredPose();
  startPosePersistence();
  startUsagePolling();
  reconnectActiveRun();
  document.querySelector<HTMLFormElement>("#prompt-form")!.addEventListener("submit", submitPrompt);
  document.querySelector<HTMLButtonElement>("#save-room")!.addEventListener("click", saveRoom);
  document.querySelector<HTMLButtonElement>("#reset-room")!.addEventListener("click", resetRoom);
  document.querySelector<HTMLSelectElement>("#room-loader")!.addEventListener("change", loadRoomSelection);
  document.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", logout);
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
    state.activeRunId = null;
    state.isWorking = false;
    activeSource?.close();
    activeSource = null;
    clearStoredSession();
    renderLanding();
  }
}

async function submitPrompt(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const values = Object.fromEntries(new FormData(form).entries());
  const result = await api<{ runId: string }>("/api/agent/runs", {
    method: "POST",
    body: { prompt: values.prompt, model: values.model, currentConfig: state.config },
  });
  state.activeRunId = result.runId;
  state.isWorking = true;
  persistSessionState();
  updateTelemetry();
  streamRun(result.runId);
  form.reset();
}

function streamRun(runId: string) {
  activeSource?.close();
  const source = new EventSource(`/api/agent/runs/${runId}/events`);
  activeSource = source;
  source.onmessage = (message) => {
    const event = parseAgentEvent(message);
    if (event) handleAgentEvent(event);
  };
  for (const eventName of ["log", "cost", "room-updated", "scene-updated", "permission-request", "complete", "error"]) {
    source.addEventListener(eventName, (message) => {
      const event = parseAgentEvent(message as MessageEvent);
      if (!event) return;
      handleAgentEvent(event);
      if (event.type === "complete" || event.type === "permission-request" || event.type === "error") {
        source.close();
        if (activeSource === source) activeSource = null;
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

function handleAgentEvent(event: AgentEvent) {
  if (event.type === "log") state.logs.push(event.message);
  if (event.type === "cost") state.totalCost += event.usd;
  if (event.type === "permission-request") state.logs.push(`PERMISSION REQUIRED: ${event.request.reason} -> ${event.request.requestedPath}`);
  if (event.type === "error") state.logs.push(`ERROR: ${event.message}`);
  if (event.type === "complete" || event.type === "permission-request" || event.type === "error") {
    state.activeRunId = null;
    state.isWorking = false;
  }
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
    state.logs.push("Scene module updated.");
  }
  updateTelemetry();
  persistSessionState();
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
  state.activeRunId = null;
  state.isWorking = false;
  activeSource?.close();
  activeSource = null;
  renderer?.applyScene(activeRoomScene);
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
  state.config = result.room.config;
  state.logs.push(`Loaded ${result.room.name}.`);
  renderWorkspace();
}

function updateTelemetry() {
  document.querySelector("#usage")!.textContent = sessionUsageLabel();
  document.querySelector("#logs")!.textContent = state.logs.join("\n");
  const working = document.querySelector<HTMLElement>("#working-indicator");
  if (working) working.hidden = !state.isWorking;
}

function accountLabel(): string {
  if (!state.user) return "OpenAI connected";
  if (state.user.authMode === "chatgpt") {
    return state.user.planType ? `ChatGPT ${state.user.planType}` : "ChatGPT account";
  }
  return state.user.openAiAccountLabel;
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
  chatGptPoll = undefined;
  usagePoll = undefined;
}

function reconnectActiveRun(): void {
  if (!state.activeRunId || activeSource) return;
  streamRun(state.activeRunId);
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
  activeRunId: string | null;
  isWorking: boolean;
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
      activeRunId: typeof parsed.activeRunId === "string" ? parsed.activeRunId : null,
      isWorking: Boolean(parsed.isWorking),
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
      activeRunId: state.activeRunId,
      isWorking: state.isWorking,
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
  return { logs: [], promptRuns: 0, activeRunId: null, isWorking: false, pose: null };
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
