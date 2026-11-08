import type { ReleaseManifest } from '../src/lib/releases';
export function runtimeRevision(root: string): Promise<string>;
export function files(root: string, prefix?: string): Promise<string[]>;
export function assetType(file: string): string;
export function packageRelease(root: string, info: { id: string; runtime: string; version: string; createdAt: string }): Promise<ReleaseManifest>;
