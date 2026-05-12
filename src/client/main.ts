import "./styles/app.css";
import type { AgentEvent, PublicUser, SavedRoom } from "../shared/api";
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
let previewRenderer: RoomRenderer | null = null;

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
  previewRenderer?.dispose();
  renderer?.dispose();
  app.innerHTML = `
    <main class="landing-shell">
      <section class="landing-copy">
        <nav class="landing-nav">
          <strong>Roomscape</strong>
          <button id="open-auth" type="button">Start</button>
        </nav>
        <div class="landing-title">
          <p class="eyebrow">Co-created interiors</p>
          <h1>Roomscape</h1>
          <p>Walk through an empty room and shape it with an AI Architect that edits the scene around you.</p>
          <button id="hero-auth" type="button">Connect OpenAI</button>
        </div>
      </section>
      <section class="landing-preview" aria-hidden="true">
        <div class="landing-vignette"></div>
      </section>
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#open-auth")!.addEventListener("click", renderOpenAiAuth);
  document.querySelector<HTMLButtonElement>("#hero-auth")!.addEventListener("click", renderOpenAiAuth);
  const preview = document.querySelector<HTMLElement>(".landing-preview")!;
  previewRenderer = new RoomRenderer(preview);
  previewRenderer.applyConfig({
    ...state.config,
    objects: [
      {
        id: "landing-table",
        kind: "table",
        label: "Signal table",
        color: "#d6f36f",
        position: [-1.8, 0.55, -1.8],
        scale: [1.4, 0.45, 0.85],
      },
      {
        id: "landing-column",
        kind: "column",
        label: "Blue column",
        color: "#4b7bd8",
        position: [1.7, 1.2, -2.7],
        scale: [0.5, 2.4, 0.5],
      },
    ],
  });
  previewRenderer.start();
}

function renderOpenAiAuth() {
  previewRenderer?.dispose();
  app.innerHTML = `
    <main class="entry-shell">
      <section class="entry-panel">
        <button id="back-home" class="quiet-button" type="button">Roomscape</button>
        <div>
          <p class="eyebrow">OpenAI authentication</p>
          <h1>Connect your OpenAI account.</h1>
        </div>
        <form id="openai-form" class="auth-form">
          <input name="openAiKey" placeholder="OpenAI API key" type="password" autocomplete="off" required />
          <button type="submit">Continue</button>
        </form>
        <p id="auth-error" class="form-error"></p>
      </section>
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#back-home")!.addEventListener("click", renderLanding);
  document.querySelector<HTMLFormElement>("#openai-form")!.addEventListener("submit", submitOpenAiAuth);
}

async function submitOpenAiAuth(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api<{ user: PublicUser }>("/api/auth/openai", { method: "POST", body });
    state.user = result.user;
    if (result.user.isArchitectConfigured) {
      await loadRooms();
      renderWorkspace();
    } else {
      renderArchitectSetup();
    }
  } catch (error) {
    document.querySelector("#auth-error")!.textContent = error instanceof Error ? error.message : "Unable to authenticate.";
  }
}

function renderArchitectSetup() {
  previewRenderer?.dispose();
  app.innerHTML = `
    <main class="entry-shell architect-entry">
      <section class="entry-panel wide">
        <p class="eyebrow">${escapeHtml(state.user?.openAiAccountLabel ?? "OpenAI connected")}</p>
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
  previewRenderer?.dispose();
  app.innerHTML = `
    <main class="workspace">
      <div id="room-canvas" class="room-canvas"></div>
      <aside class="overlay">
        <div class="identity">
          <span>${state.user?.openAiAccountLabel ?? ""}</span>
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
  import.meta.hot.accept("../../sandbox/rooms/active/roomConfig", (module) => {
    if (!module?.roomConfig) return;
    const pose = renderer?.pose();
    state.config = module.roomConfig;
    renderer?.applyConfig(module.roomConfig);
    if (pose) renderer?.restorePose(pose);
  });
}
