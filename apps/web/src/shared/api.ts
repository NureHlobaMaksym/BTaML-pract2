import { UserError } from "./user-error";
import { ERROR_MESSAGES } from "../../../../shared/constants/contract-error-messages";

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new UserError(data.code && ERROR_MESSAGES[data.code] ? ERROR_MESSAGES[data.code] : response.status === 429 ? "Зачекайте хвилину перед наступною спробою." : "Не вдалося виконати запит. Спробуйте ще раз трохи пізніше.");
  return data as T;
}
