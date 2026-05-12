import "./styles/app.css";
import type { AgentEvent, ChatGptAuthStatus, ChatGptLoginStart, ChatGptUsage, PublicUser, SavedRoom } from "../shared/api";
import { modelOptions } from "../shared/models";
import type { RoomConfig } from "../shared/room";
import { roomConfig } from "../../sandbox/rooms/active/roomConfig";
import { RoomRenderer } from "./room/RoomRenderer";

const app = document.querySelector<HTMLDivElement>("#app")!;

interface ClientState {
  user: PublicUser | null;
  config: RoomConfig;
  logs: string[];
  totalCost: number;
  promptRuns: number;
  chatGptUsage: string | null;
  rooms: SavedRoom[];
}

const state: ClientState = {
  user: null,
  config: roomConfig,
  logs: [],
  totalCost: 0,
  promptRuns: 0,
  chatGptUsage: null,
  rooms: [],
};

let renderer: RoomRenderer | null = null;
let chatGptPoll: number | undefined;
let usagePoll: number | undefined;

void boot();

async function boot() {
  const session = await api<{ user: PublicUser | null }>("/api/session");
  state.user = session.user;
  if (state.user) {
    if (state.user.isArchitectConfigured) {
      await loadRooms();
      renderWorkspace();
    } else {
      renderArchitectSetup();
    }
  } else {
    renderLanding();
  }
}

function renderLanding() {
  clearPolling();
  renderer?.dispose();
  app.innerHTML = `
    <main class="landing-shell">
      <section class="landing-title">
        <p class="eyebrow">Co-created interiors</p>
        <h1>Roomscape</h1>
        <p>Explore the world while building it.</p>
        <button id="open-auth" type="button">Log in with ChatGPT</button>
      </section>
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#open-auth")!.addEventListener("click", renderChatGptAuth);
}

function renderChatGptAuth() {
  app.innerHTML = `
    <main class="entry-shell">
      <section class="entry-panel">
        <button id="back-home" class="quiet-button" type="button">Roomscape</button>
        <div>
          <p class="eyebrow">ChatGPT authentication</p>
          <h1>Connect your ChatGPT account.</h1>
        </div>
        <button id="chatgpt-login" type="button">Continue with ChatGPT</button>
        <p id="chatgpt-note" class="form-note">Roomscape uses Codex managed OAuth for ChatGPT accounts.</p>
        <a id="chatgpt-auth-link" class="auth-link" target="_blank" rel="noreferrer" hidden>Open ChatGPT sign-in</a>
        <button id="chatgpt-finish" class="quiet-button" type="button" hidden>I finished signing in</button>
        <p id="auth-error" class="form-error"></p>
      </section>
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#back-home")!.addEventListener("click", renderLanding);
  document.querySelector<HTMLButtonElement>("#chatgpt-login")!.addEventListener("click", startChatGptAuth);
}

async function startChatGptAuth() {
  const button = document.querySelector<HTMLButtonElement>("#chatgpt-login")!;
  const note = document.querySelector<HTMLElement>("#chatgpt-note")!;
  const link = document.querySelector<HTMLAnchorElement>("#chatgpt-auth-link")!;
  const finish = document.querySelector<HTMLButtonElement>("#chatgpt-finish")!;
  button.disabled = true;
  note.textContent = "Starting Codex ChatGPT OAuth...";
  try {
    const login = await api<ChatGptLoginStart>("/api/auth/chatgpt/start", { method: "POST" });
    link.href = login.authUrl;
    link.hidden = false;
    finish.hidden = false;
    note.textContent = "Open the sign-in page, approve access, then return here.";
    finish.onclick = () => void completeChatGptAuth(login.loginId);
    chatGptPoll = window.setInterval(() => void completeChatGptAuth(login.loginId, true), 2_500);
  } catch (error) {
    button.disabled = false;
    document.querySelector("#auth-error")!.textContent = error instanceof Error ? error.message : "Unable to start ChatGPT login.";
  }
}

async function completeChatGptAuth(loginId: string, quiet = false) {
  const note = document.querySelector<HTMLElement>("#chatgpt-note");
  if (!quiet && note) note.textContent = "Checking ChatGPT login...";
  try {
    const result = await api<ChatGptAuthStatus>("/api/auth/chatgpt/complete", { method: "POST", body: { loginId } });
    if (result.status !== "authenticated" || !result.user) {
      if (!quiet && note) note.textContent = "Still waiting for ChatGPT approval.";
      return;
    }
    clearPolling();
    state.user = result.user;
    if (result.user.isArchitectConfigured) {
      await loadRooms();
      renderWorkspace();
    } else {
      renderArchitectSetup();
    }
  } catch (error) {
    clearPolling();
    document.querySelector("#auth-error")!.textContent = error instanceof Error ? error.message : "Unable to complete ChatGPT login.";
    const button = document.querySelector<HTMLButtonElement>("#chatgpt-login");
    if (button) button.disabled = false;
  }
}

function renderArchitectSetup() {
  app.innerHTML = `
    <main class="entry-shell architect-entry">
      <section class="entry-panel wide">
        <p class="eyebrow">${escapeHtml(accountLabel())}</p>
        <h1>Name your Architect.</h1>
        <form id="architect-form" class="auth-form">
          <input name="architectName" placeholder="Architect name, e.g. Gulf Futurist" value="${escapeHtml(state.user?.architectName ?? "")}" required />
          <textarea name="architectDescription" rows="5" placeholder="Architect description" required>${escapeHtml(state.user?.architectDescription ?? "")}</textarea>
          <button type="submit">Enter the Room</button>
        </form>
        <p id="architect-error" class="form-error"></p>
      </section>
    </main>
  `;
  document.querySelector<HTMLFormElement>("#architect-form")!.addEventListener("submit", submitArchitect);
}

async function submitArchitect(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api<{ user: PublicUser }>("/api/architect", { method: "POST", body });
    state.user = result.user;
    await loadRooms();
    renderWorkspace();
  } catch (error) {
    document.querySelector("#architect-error")!.textContent = error instanceof Error ? error.message : "Unable to save Architect.";
  }
}

function renderWorkspace() {
  clearPolling();
  app.innerHTML = `
    <main class="workspace">
      <div id="room-canvas" class="room-canvas"></div>
      <aside class="overlay">
        <div class="identity">
          <span>${escapeHtml(accountLabel())}</span>
          <strong>${state.user?.architectName ?? ""}</strong>
        </div>
        <form id="prompt-form" class="prompt-form">
          <select name="model">
            ${modelOptions.map((model) => `<option value="${model.id}">${model.label}</option>`).join("")}
          </select>
          <textarea name="prompt" rows="4" placeholder="Ask the Architect to add, revise, or restyle the room." required></textarea>
          <button type="submit">Build</button>
        </form>
        <div class="actions">
          <input id="room-name" value="${escapeHtml(state.config.name)}" />
          <button id="save-room" type="button">Save</button>
        </div>
        <select id="room-loader">
          <option value="">Load saved room</option>
          ${state.rooms.map((room) => `<option value="${room.id}">${escapeHtml(room.name)}</option>`).join("")}
        </select>
        <div class="telemetry">
          <div><span>Session usage</span><strong id="usage">${escapeHtml(sessionUsageLabel())}</strong></div>
          <pre id="logs">${state.logs.map(escapeHtml).join("\n")}</pre>
        </div>
      </aside>
    </main>
  `;

  renderer?.dispose();
  renderer = new RoomRenderer(document.querySelector("#room-canvas")!);
  renderer.applyConfig(state.config);
  renderer.start();
  startUsagePolling();
  document.querySelector<HTMLFormElement>("#prompt-form")!.addEventListener("submit", submitPrompt);
  document.querySelector<HTMLButtonElement>("#save-room")!.addEventListener("click", saveRoom);
  document.querySelector<HTMLSelectElement>("#room-loader")!.addEventListener("change", loadRoomSelection);
}

async function submitPrompt(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const values = Object.fromEntries(new FormData(form).entries());
  const result = await api<{ runId: string }>("/api/agent/runs", {
    method: "POST",
    body: { prompt: values.prompt, model: values.model, currentConfig: state.config },
  });
  streamRun(result.runId);
  form.reset();
}

function streamRun(runId: string) {
  const source = new EventSource(`/api/agent/runs/${runId}/events`);
  source.onmessage = (message) => handleAgentEvent(JSON.parse(message.data) as AgentEvent);
  for (const eventName of ["log", "cost", "room-updated", "permission-request", "complete", "error"]) {
    source.addEventListener(eventName, (message) => {
      const event = JSON.parse((message as MessageEvent).data) as AgentEvent;
      handleAgentEvent(event);
      if (event.type === "complete" || event.type === "permission-request" || event.type === "error") source.close();
    });
  }
}

function handleAgentEvent(event: AgentEvent) {
  if (event.type === "log") state.logs.push(event.message);
  if (event.type === "cost") state.totalCost += event.usd;
  if (event.type === "permission-request") state.logs.push(`PERMISSION REQUIRED: ${event.request.reason} -> ${event.request.requestedPath}`);
  if (event.type === "error") state.logs.push(`ERROR: ${event.message}`);
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
  updateTelemetry();
}

async function saveRoom() {
  const name = document.querySelector<HTMLInputElement>("#room-name")!.value;
  await api("/api/rooms", { method: "POST", body: { name, config: state.config } });
  await loadRooms();
  renderWorkspace();
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
  renderWorkspace();
}

function updateTelemetry() {
  document.querySelector("#usage")!.textContent = sessionUsageLabel();
  document.querySelector("#logs")!.textContent = state.logs.join("\n");
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
}
