import type { Deployment } from "../../../../shared/interfaces/deployment";

export interface PublicConfig extends Deployment { relayEnabled: boolean; }
