// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderWithI18n } from "./helpers/dom";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

afterEach(cleanup);

function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirmDialog();
  return (
    <>
      <button onClick={async () => onResult(await confirm({ message: "¿Eliminar este día?", confirmLabel: "Eliminar" }))}>borrar</button>
      {dialog}
    </>
  );
}

describe("useConfirmDialog", () => {
  it("asks inside the app and resolves with the answer", async () => {
    const onResult = vi.fn();
    renderWithI18n(<Harness onResult={onResult} />);

    fireEvent.click(screen.getByText("borrar"));
    expect(screen.getByRole("alertdialog", { name: "¿Eliminar este día?" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancelar" })));
    expect(onResult).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByText("borrar"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Eliminar" })));
    expect(onResult).toHaveBeenLastCalledWith(true);
  });

  it("treats Escape as cancel", async () => {
    const onResult = vi.fn();
    renderWithI18n(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("borrar"));
    await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
    expect(onResult).toHaveBeenLastCalledWith(false);
  });
});

describe("no browser dialogs", () => {
  it("components never use window alert or confirm", () => {
    const dir = path.resolve(__dirname, "../components");
    const offenders = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => {
        const source = readFileSync(path.join(dir, file), "utf8");
        // alert() never has a local stand-in; confirm() is fine only as useConfirmDialog's.
        const browserAlert = /(^|[^.\w])alert\(|window\.(alert|confirm)\(/.test(source);
        const browserConfirm = /(^|[^.\w])confirm\(/.test(source) && !source.includes("useConfirmDialog");
        return browserAlert || browserConfirm;
      });
    expect(offenders).toEqual([]);
  });
});
