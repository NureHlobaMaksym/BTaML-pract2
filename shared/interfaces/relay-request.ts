export interface RelayRequest {
  creator: string;
  title: string;
  goal: string;
  deadline: number;
  expiresAt: number;
  signature: string;
}
