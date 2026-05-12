import "./styles/app.css";
import type { AgentEvent, PublicUser, SavedRoom } from "../shared/api";
import { modelOptions } from "../shared/models";
import type { RoomConfig } from "../shared/room";
import { roomConfig } from "./rooms/active/roomConfig";
import { RoomRenderer } from "./room/RoomRenderer";

const app = document.querySelector<HTMLDivElement>("#app")!;

interface ClientState {
  user: PublicUser | null;
  config: RoomConfig;
  logs: string[];
  totalCost: number;
  rooms: SavedRoom[];
}

const state: ClientState = {
  user: null,
  config: roomConfig,
  logs: [],
  totalCost: 0,
  rooms: [],
};

let renderer: RoomRenderer | null = null;

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
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-panel">
        <p class="eyebrow">Roomscape</p>
        <h1>Build the room while you walk through it.</h1>
        <form id="register-form" class="auth-form">
          <input name="username" minlength="3" placeholder="Username" autocomplete="username" required />
          <input name="password" minlength="8" placeholder="Password" type="password" autocomplete="new-password" required />
          <input name="openAiKey" placeholder="OpenAI API key" type="password" autocomplete="off" required />
          <input name="architectPersona" placeholder="Architect persona, e.g. Gulf Futurist" required />
          <button type="submit">Enter Roomscape</button>
        </form>
        <form id="login-form" class="auth-form compact">
          <input name="username" placeholder="Username" autocomplete="username" required />
          <input name="password" placeholder="Password" type="password" autocomplete="current-password" required />
          <button type="submit">Log in</button>
        </form>
        <p id="auth-error" class="form-error"></p>
      </section>
      <section class="preview-room" aria-hidden="true"></section>
    </main>
  `;
  document.querySelector<HTMLFormElement>("#register-form")!.addEventListener("submit", (event) => submitAuth(event, "/api/auth/register"));
  document.querySelector<HTMLFormElement>("#login-form")!.addEventListener("submit", (event) => submitAuth(event, "/api/auth/login"));
  const preview = document.querySelector<HTMLElement>(".preview-room")!;
  const previewRenderer = new RoomRenderer(preview);
  previewRenderer.applyConfig(state.config);
  previewRenderer.start();
}

async function submitAuth(event: SubmitEvent, endpoint: string) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api<{ user: PublicUser }>(endpoint, { method: "POST", body });
    state.user = result.user;
    await loadRooms();
    renderWorkspace();
  } catch (error) {
    document.querySelector("#auth-error")!.textContent = error instanceof Error ? error.message : "Unable to authenticate.";
  }
}

function renderWorkspace() {
  app.innerHTML = `
    <main class="workspace">
      <div id="room-canvas" class="room-canvas"></div>
      <aside class="overlay">
        <div class="identity">
          <span>${state.user?.username ?? ""}</span>
          <strong>${state.user?.architectPersona ?? ""}</strong>
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
          <div><span>Session cost</span><strong id="cost">$${state.totalCost.toFixed(4)}</strong></div>
          <pre id="logs">${state.logs.map(escapeHtml).join("\n")}</pre>
        </div>
      </aside>
    </main>
  `;

  renderer?.dispose();
  renderer = new RoomRenderer(document.querySelector("#room-canvas")!);
  renderer.applyConfig(state.config);
  renderer.start();
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
  document.querySelector("#cost")!.textContent = `$${state.totalCost.toFixed(4)}`;
  document.querySelector("#logs")!.textContent = state.logs.join("\n");
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
  import.meta.hot.accept("./rooms/active/roomConfig", (module) => {
    if (!module?.roomConfig) return;
    const pose = renderer?.pose();
    state.config = module.roomConfig;
    renderer?.applyConfig(module.roomConfig);
    if (pose) renderer?.restorePose(pose);
  });
}
