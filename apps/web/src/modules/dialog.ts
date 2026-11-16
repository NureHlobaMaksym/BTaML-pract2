import { updateDeadlineBounds } from "./campaign-deadline";

let returnFocus: HTMLElement | null = null;

export function openDialog(id: string) {
  returnFocus = document.activeElement as HTMLElement;
  const dialog = document.getElementById(id) as HTMLDialogElement;
  dialog.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]').forEach(updateDeadlineBounds);
  dialog.showModal();
  document.body.classList.add("dialog-open");
}
export function closeDialog(dialog: HTMLDialogElement) {
  dialog.close();
}
export function initializeDialogs() {
  document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]').forEach(input => {
    input.addEventListener("focus", () => updateDeadlineBounds(input));
  });
  document.querySelectorAll<HTMLDialogElement>("dialog").forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => { document.body.classList.remove("dialog-open"); returnFocus?.focus(); });
    dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = () => closeDialog(dialog);
  });
}
