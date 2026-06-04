export type MeshLanInterface = {
  name: string;
  address: string;
  netmask: string;
  mac?: string;
  cidr?: string | null;
  score: number;
};

export function getBroadcastAddresses(): string[];
export function getConfiguredFallbackIps(): string[];
export function getLanInterfaces(): MeshLanInterface[];
export function getLanIps(): string[];
export function getLocalIps(): string[];
export function getNetworkSummary(): {
  ready: boolean;
  selectedIp: string;
  selectedInterface: string | null;
  interfaces: MeshLanInterface[];
};
export function getPreferredLanIp(): string;
export function getPreferredLanMac(): string;
export function isLanReady(): boolean;
export function isLocalIp(ip: string): boolean;
export function normalizeIp(ip: string): string;
