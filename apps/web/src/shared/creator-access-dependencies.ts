export interface CreatorAccessDependencies {
  ownAddress(): Promise<string>;
  readAccess(address: string): Promise<boolean>;
  changeAccess(address: string, enabled: boolean): Promise<void>;
  run(action: () => Promise<unknown>): void;
  notify(message: string): void;
}
