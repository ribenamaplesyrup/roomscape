import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { RoomConfig } from "../../shared/room";
import { evaluateSandboxPath } from "./sandboxPolicy";

export class SandboxViolationError extends Error {
  public constructor(public readonly request: NonNullable<ReturnType<typeof evaluateSandboxPath>["permissionRequest"]>) {
    super("Agent attempted to access a path outside the active generated-room workspace.");
  }
}

export class RoomCodeRepository {
  public constructor(
    public readonly sandboxRoot: string,
    private readonly configFile = "roomConfig.ts",
    private readonly sceneFile = "roomScene.ts",
    private readonly activeSceneFile = "activeRoomScene.ts",
  ) {}

  /** Writes the active room config as TypeScript so Vite can hot-reload the scene module. */
  public async writeConfig(config: RoomConfig): Promise<string> {
    const decision = evaluateSandboxPath(this.sandboxRoot, this.configFile, "Write generated room configuration.");
    if (!decision.allowed || !decision.normalizedPath) {
      throw new SandboxViolationError(decision.permissionRequest!);
    }
    await mkdir(path.dirname(decision.normalizedPath), { recursive: true });
    const body = [
      'import type { RoomConfig } from "../../../src/shared/room";',
      "",
      "export const roomConfig = " + JSON.stringify(config, null, 2) + " satisfies RoomConfig;",
      "",
    ].join("\n");
    await writeFile(decision.normalizedPath, body, "utf8");
    return decision.normalizedPath;
  }

  /** Writes the editable Three.js scene module back to the blank starter room. */
  public async writeFreshScene(): Promise<string> {
    const source = freshSceneSource();
    await this.writeSceneSource(source);
    return this.writeActiveSceneSource(source);
  }

  /** Writes the Codex-editable Three.js scene source. */
  public async writeSceneSource(source: string): Promise<string> {
    return this.writeTextFile(this.sceneFile, source, "Write Three.js room scene.");
  }

  /** Writes the browser-facing scene module only after validation passes. */
  public async writeActiveSceneSource(source: string): Promise<string> {
    return this.writeTextFile(this.activeSceneFile, source, "Promote validated Three.js room scene.");
  }

  /** Removes common model-authored TypeScript annotations that are unsafe in the sandbox contract. */
  public normalizeSceneSource(source: string): string {
    return source
      .replace(/(\b(?:const|let|var)\s+[A-Za-z_$][\w$]*)\s*:\s*THREE\.[A-Za-z0-9_$.[\]<>, |&?]+(?=\s*=)/g, "$1")
      .replace(/(\)\s*):\s*THREE\.[A-Za-z0-9_$.[\]<>, |&?]+(?=\s*(?:=>|\{))/g, "$1")
      .replace(/(function\s+[A-Za-z_$][\w$]*\s*\([^)]*\))\s*:\s*THREE\.[A-Za-z0-9_$.[\]<>, |&?]+(?=\s*\{)/g, "$1");
  }

  /** Reads the editable Three.js scene module as text for Codex context. */
  public async readRawScene(): Promise<string> {
    return this.readTextFile(this.sceneFile, "Read Three.js room scene.");
  }

  /** Reads the browser-facing scene module as text for save/load persistence. */
  public async readRawActiveScene(): Promise<string> {
    return this.readTextFile(this.activeSceneFile, "Read active Three.js room scene.");
  }

  /** Validates scene source before it can be promoted to the browser-facing module. */
  public validateSceneSource(source: string): string[] {
    const errors: string[] = [];
    const normalizedSource = this.normalizeSceneSource(source);
    if (!source.includes("export const roomTitle")) {
      errors.push("roomScene.ts must export const roomTitle.");
    }
    if (!source.includes("export function buildRoom")) {
      errors.push("roomScene.ts must export function buildRoom(...).");
    }
    if (/new\s+THREE\.WebGLRenderer|new\s+THREE\.PerspectiveCamera|document\.|window\.|fetch\s*\(|setTimeout\s*\(|setInterval\s*\(|requestAnimationFrame\s*\(/.test(normalizedSource)) {
      errors.push("roomScene.ts must not create renderers/cameras, touch DOM/window, perform network calls, or start timers.");
    }
    if (/(?:\b(?:const|let|var)\s+[A-Za-z_$][\w$]*|\)\s*|function\s+[A-Za-z_$][\w$]*\s*\([^)]*\))\s*:\s*THREE\./.test(normalizedSource)) {
      errors.push("roomScene.ts must not use THREE.* namespace type annotations; let local Three.js values infer their types.");
    }
    errors.push(...findUnsafeShorthandProperties(normalizedSource));
    const diagnostics = ts.transpileModule(normalizedSource, {
      compilerOptions: {
        isolatedModules: true,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    }).diagnostics ?? [];
    for (const diagnostic of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      errors.push(`TypeScript: ${message}`);
    }
    return errors;
  }

  private async readTextFile(fileName: string, reason: string): Promise<string> {
    const decision = evaluateSandboxPath(this.sandboxRoot, fileName, reason);
    if (!decision.allowed || !decision.normalizedPath) {
      throw new SandboxViolationError(decision.permissionRequest!);
    }
    return readFile(decision.normalizedPath, "utf8");
  }

  private async writeTextFile(fileName: string, source: string, reason: string): Promise<string> {
    const decision = evaluateSandboxPath(this.sandboxRoot, fileName, reason);
    if (!decision.allowed || !decision.normalizedPath) {
      throw new SandboxViolationError(decision.permissionRequest!);
    }
    await mkdir(path.dirname(decision.normalizedPath), { recursive: true });
    await writeFile(decision.normalizedPath, source, "utf8");
    return decision.normalizedPath;
  }

  /** Deliberately exposes policy checks for agent tools before touching disk. */
  public ensureInsideSandbox(requestedPath: string, reason: string, command?: string): string {
    const decision = evaluateSandboxPath(this.sandboxRoot, requestedPath, reason, command);
    if (!decision.allowed || !decision.normalizedPath) {
      throw new SandboxViolationError(decision.permissionRequest!);
    }
    return decision.normalizedPath;
  }
}

export function transpileSceneSource(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: {
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function findUnsafeShorthandProperties(source: string): string[] {
  const file = ts.createSourceFile("roomScene.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const declared = new Set<string>();
  const unsafe: string[] = [];

  const rememberBindingName = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      declared.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) rememberBindingName(element.name);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) || ts.isImportClause(node) && node.name) {
      if ("name" in node && node.name) declared.add(node.name.text);
    }
    if (ts.isFunctionDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isFunctionExpression(node) && node.name) declared.add(node.name.text);
    if (ts.isParameter(node)) rememberBindingName(node.name);
    if (ts.isVariableDeclaration(node)) rememberBindingName(node.name);
    if (ts.isShorthandPropertyAssignment(node) && !declared.has(node.name.text)) {
      unsafe.push(`roomScene.ts uses shorthand property '${node.name.text}' without declaring it; write an explicit value such as ${node.name.text}: THREE.DoubleSide.`);
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return unsafe;
}

export function freshSceneSource(): string {
  return `import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";

export const roomTitle = "Bare Room";

export function buildRoom({ THREE, root, scene }: RoomSceneContext): void {
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

  const ambient = new THREE.HemisphereLight("#ffffff", "#555555", 1.2);
  root.add(ambient);

  const directional = new THREE.DirectionalLight("#ffffff", 0.6);
  directional.position.set(2, 4, 3);
  root.add(directional);
}
`;
}
