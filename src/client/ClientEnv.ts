import { JWK } from "jose";
import { z } from "zod";
import { ClusterConfig } from "../core/ClusterConfig";
import { GameID } from "../core/Schemas";
import { ServerList } from "../core/ServerList";
import { simpleHash } from "../core/Util";
import {
  GameEnv,
  JwksSchema,
  parseGameEnv,
} from "../core/configuration/Config";

/**
 * Raised when no server can be derived from the API list or window configuration.
 */
export class NoServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoServerError";
  }
}

// Render Backend Fallback Host (sanitized without protocol or trailing slash)
const RENDER_BACKEND_HOST = "my-openfront-offline-vs-bots.onrender.com";

export class ClientEnv {
  private static values: ClientEnvValues | null = null;
  private static publicKey: JWK | null = null;
  private static apiList: {
    list: ServerList;
    picked: string | null;
  } | null = null;

  /** Test-only reset helper. */
  static reset(): void {
    ClientEnv.values = null;
    ClientEnv.publicKey = null;
    ClientEnv.apiList = null;
  }

  static applyServerList(list: ServerList | null, picked: string | null) {
    ClientEnv.apiList = list === null ? null : { list, picked };
  }

  static serverListLoaded(): boolean {
    return ClientEnv.apiList !== null;
  }

  static servedByGameServer(): boolean {
    const v = ClientEnv.get();
    if (v.serverHost !== undefined) return true;
    return v.cluster !== undefined && v.instanceLetter !== undefined;
  }

  private static pickedServer(): { host: string; numWorkers: number } | null {
    const a = ClientEnv.apiList;
    if (a === null || a.picked === null) return null;
    return a.list.servers[a.picked] ?? null;
  }

  private static get(): ClientEnvValues {
    if (ClientEnv.values) return ClientEnv.values;
    if (typeof window === "undefined") {
      throw new Error("ClientEnv is only available on the browser main thread");
    }
    const bc = window.BOOTSTRAP_CONFIG;
    if (
      !bc ||
      bc.gameEnv === undefined ||
      bc.turnstileSiteKey === undefined ||
      bc.jwtAudience === undefined ||
      bc.gitCommit === undefined
    ) {
      throw new Error("Missing BOOTSTRAP_CONFIG");
    }
    ClientEnv.values = {
      gameEnv: parseGameEnv(bc.gameEnv),
      cluster: bc.cluster,
      instanceLetter: bc.instanceLetter,
      numWorkers: bc.numWorkers,
      turnstileSiteKey: bc.turnstileSiteKey,
      jwtAudience: bc.jwtAudience,
      stripePublishableKey: bc.stripePublishableKey,
      instanceId: bc.instanceId ?? "",
      gitCommit: bc.gitCommit,
      serverHost: bc.serverHost,
      siteHost: bc.siteHost,
    };
    return ClientEnv.values;
  }

  static env(): GameEnv {
    return ClientEnv.get().gameEnv;
  }

  static stripePublishableKey(): string | undefined {
    return ClientEnv.get().stripePublishableKey;
  }

  static numWorkers(): number {
    const picked = ClientEnv.pickedServer();
    if (picked !== null) return picked.numWorkers;
    try {
      const v = ClientEnv.get();
      if (v.cluster !== undefined && v.instanceLetter !== undefined) {
        const own = v.cluster[v.instanceLetter];
        if (own === undefined) {
          throw new Error(
            `BOOTSTRAP_CONFIG instanceLetter ${v.instanceLetter} not in cluster map`,
          );
        }
        return own.numWorkers;
      }
      if (v.numWorkers !== undefined) {
        return v.numWorkers;
      }
    } catch {
      // Fall through to single-worker mode if window.BOOTSTRAP_CONFIG is missing
    }
    return 1;
  }

  static cluster(): ClusterConfig | undefined {
    try {
      return ClientEnv.get().cluster;
    } catch {
      return undefined;
    }
  }

  static instanceLetter(): string | undefined {
    try {
      return ClientEnv.get().instanceLetter;
    } catch {
      return undefined;
    }
  }

  static turnstileSiteKey(): string {
    return ClientEnv.get().turnstileSiteKey;
  }

  static jwtAudience(): string {
    return ClientEnv.get().jwtAudience;
  }

  static instanceId(): string {
    return ClientEnv.get().instanceId;
  }

  static gitCommit(): string {
    return ClientEnv.get().gitCommit;
  }

  static jwtIssuer(): string {
    const audience = ClientEnv.jwtAudience();
    return audience === "localhost"
      ? "http://localhost:8787"
      : `https://api.${audience}`;
  }

  static async jwkPublicKey(): Promise<JWK> {
    if (ClientEnv.publicKey) return ClientEnv.publicKey;
    const jwksUrl = ClientEnv.jwtIssuer() + "/.well-known/jwks.json";
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`JWKS fetch failed: ${response.status} ${body}`);
    }
    const result = JwksSchema.safeParse(await response.json());
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing JWKS", error);
      throw new Error("Invalid JWKS");
    }
    ClientEnv.publicKey = result.data.keys[0];
    return ClientEnv.publicKey;
  }

  static turnIntervalMs(): number {
    return 100;
  }

  static gameCreationRate(): number {
    try {
      return ClientEnv.env() === GameEnv.Dev ? 5 * 1000 : 2 * 60 * 1000;
    } catch {
      return 2 * 60 * 1000;
    }
  }

  static workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % ClientEnv.numWorkers();
  }

  static workerPath(gameID: GameID): string {
    return `w${ClientEnv.workerIndex(gameID)}`;
  }

  static resolveGame(gameID: GameID): GameResolution {
    const a = ClientEnv.apiList;
    if (a !== null) {
      return resolveGameHost(gameID, a.list.servers, a.picked ?? undefined);
    }
    try {
      const v = ClientEnv.get();
      return resolveGameHost(gameID, v.cluster, v.instanceLetter);
    } catch {
      return { kind: "own" };
    }
  }

  static gameLetterUnknown(gameID: GameID): boolean {
    return ClientEnv.resolveGame(gameID).kind === "unknown-letter";
  }

  static gameWsBase(gameID: GameID): string {
    const r = ClientEnv.resolveGame(gameID);
    return r.kind === "cross" ? `wss://${r.host}` : ClientEnv.serverWsBase();
  }

  static gameHttpBase(gameID: GameID): string {
    const r = ClientEnv.resolveGame(gameID);
    return r.kind === "cross"
      ? `https://${r.host}`
      : ClientEnv.serverHttpBase();
  }

  static gamePath(gameID: GameID): string {
    const id = encodeURIComponent(gameID);
    try {
      return `/${ClientEnv.gameWorkerPath(gameID)}/game/${id}`;
    } catch (e) {
      if (e instanceof NoServerError) return `/game/${id}`;
      throw e;
    }
  }

  static gameVersion(gameID: GameID): string | undefined {
    const a = ClientEnv.apiList;
    if (a === null || gameID.length < 10) return undefined;
    return a.list.servers[gameID[0]]?.version;
  }

  static gameWorkerPath(gameID: GameID): string {
    const r = ClientEnv.resolveGame(gameID);
    return r.kind === "cross"
      ? `w${simpleHash(gameID) % r.numWorkers}`
      : ClientEnv.workerPath(gameID);
  }

  static serverHost(): string | undefined {
    return RENDER_BACKEND_HOST;
  }

  static siteHost(): string | undefined {
    try {
      const configured = ClientEnv.get().siteHost;
      if (configured) return configured;
      if (ClientEnv.get().gameEnv === GameEnv.Prod) return "openfront.io";
    } catch {
      // Fallback for static environments (GitHub Pages)
    }
    return undefined;
  }

  static siteOrigin(): string | undefined {
    try {
      const v = ClientEnv.get();
      const host = v.siteHost ?? v.serverHost;
      return host ? `https://${host}` : undefined;
    } catch {
      return undefined;
    }
  }

  /** Secure WebSocket Origin */
  static serverWsBase(): string {
    const picked = ClientEnv.pickedServer();
    if (picked !== null) {
      return `wss://${picked.host}`;
    }

    const configured = ClientEnv.serverHost();
    if (configured) {
      return `wss://${configured}`;
    }

    return `wss://${RENDER_BACKEND_HOST}`;
  }

  /** Secure HTTP Origin */
  static serverHttpBase(): string {
    const picked = ClientEnv.pickedServer();
    if (picked !== null) {
      return `https://${picked.host}`;
    }

    const configured = ClientEnv.serverHost();
    if (configured) {
      return `https://${configured}`;
    }

    return `https://${RENDER_BACKEND_HOST}`;
  }

  static shareOrigin(): string {
    if (typeof window !== "undefined" && window.location.hostname === "thewaystounb.github.io") {
      return "https://thewaystounb.github.io/My-openfront-offline-vs-bots";
    }

    return deriveShareOrigin(
      shareBootstrap,
      window.location.protocol,
      window.location.origin,
    );
  }

  static shareBase(): string {
    return deriveShareBase(
      shareBootstrap,
      window.location.protocol,
      window.location.origin,
      window.location.pathname,
    );
  }
}

function shareBootstrap(): { siteOrigin?: string; jwtAudience: string } {
  try {
    return {
      siteOrigin: ClientEnv.siteOrigin(),
      jwtAudience: ClientEnv.jwtAudience(),
    };
  } catch {
    return {
      siteOrigin: undefined,
      jwtAudience: "openfront.io",
    };
  }
}

export type GameResolution =
  | { kind: "own" }
  | { kind: "cross"; host: string; numWorkers: number }
  | { kind: "unknown-letter" };

export function resolveGameHost(
  gameID: string,
  cluster: Record<string, { host: string; numWorkers: number }> | undefined,
  instanceLetter: string | undefined,
): GameResolution {
  if (gameID.length < 10) return { kind: "own" };
  if (cluster === undefined) return { kind: "own" };
  const letter = gameID[0];
  const entry = cluster[letter];
  if (entry === undefined) return { kind: "unknown-letter" };
  if (letter === instanceLetter) return { kind: "own" };
  return { kind: "cross", host: entry.host, numWorkers: entry.numWorkers };
}

export function deriveServerWsBase(
  serverHost: string | undefined,
  locationProtocol: string,
  locationHost: string,
): string {
  if (serverHost) {
    return `wss://${serverHost}`;
  }
  return `${locationProtocol === "https:" ? "wss:" : "ws:"}//${locationHost}`;
}

export function deriveServerHttpBase(
  serverHost: string | undefined,
  locationProtocol: string,
  locationHost: string,
): string {
  if (serverHost) {
    return `https://${serverHost}`;
  }
  return `${locationProtocol === "https:" ? "https:" : "http:"}//${locationHost}`;
}

function isWebScheme(locationProtocol: string): boolean {
  return locationProtocol === "http:" || locationProtocol === "https:";
}

export function deriveShareOrigin(
  bootstrap: () => { siteOrigin?: string; jwtAudience: string },
  locationProtocol: string,
  locationOrigin: string,
): string {
  if (isWebScheme(locationProtocol)) return locationOrigin;
  const { siteOrigin, jwtAudience } = bootstrap();
  if (siteOrigin) return siteOrigin;
  return jwtAudience === "localhost"
    ? "http://localhost:9000"
    : `https://${jwtAudience}`;
}

export function deriveShareBase(
  bootstrap: () => { siteOrigin?: string; jwtAudience: string },
  locationProtocol: string,
  locationOrigin: string,
  locationPathname: string,
): string {
  const origin = deriveShareOrigin(bootstrap, locationProtocol, locationOrigin);
  return isWebScheme(locationProtocol)
    ? `${origin}${locationPathname}`
    : `${origin}/`;
}

export interface ClientEnvValues {
  gameEnv: GameEnv;
  cluster?: ClusterConfig;
  instanceLetter?: string;
  numWorkers?: number;
  turnstileSiteKey: string;
  jwtAudience: string;
  stripePublishableKey?: string;
  instanceId: string;
  gitCommit: string;
  serverHost?: string;
  siteHost?: string;
}