// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { TripMember } from "@/lib/types";

type DbError = { code?: string; message?: string } | null;
type Result = { data: unknown; error: DbError };

/** The fake database: results per table and rpc, plus an ordered log of every call. */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Result>,
  rpc: {} as Record<string, Result>,
  log: [] as unknown[][],
}));

vi.mock("@/lib/supabase", () => {
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "order", "insert", "delete"]) {
      q[op] = (...args: unknown[]) => (db.log.push([`${table}.${op}`, ...args]), q);
    }
    q.then = (resolve: (r: Result) => void) => resolve(db.tables[table] ?? { data: [], error: null });
    return q;
  };
  return {
    supabase: {
      from,
      rpc: async (fn: string, args: unknown) => (db.log.push(["rpc", fn, args]), db.rpc[fn] ?? { data: null, error: null }),
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          remove: async () => ({ error: null }),
          createSignedUrl: async () => ({ data: null, error: { message: "no" } }),
        }),
      },
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: async () => ({ data: { session: null } }),
      },
    },
  };
});

const { ExpensesView } = await import("@/components/expenses/ExpensesView");
const { clearTripMembersCache } = await import("@/components/memories/use-trip-members");
const { clearTripExpensesCache } = await import("@/hooks/use-trip-expenses");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useOfflineStore } = await import("@/store/use-offline-store");

const TRIP = "t";
const MEMBERS: TripMember[] = [
  { userId: "hernan", email: "hernan@x.io", isOwner: true, displayName: "Hernán L" },
  { userId: "maria", email: "maria@x.io", isOwner: false, displayName: "María" },
  { userId: "jack", email: "jack@x.io", isOwner: false, displayName: "Jack" },
  { userId: "ana", email: "ana@x.io", isOwner: false, displayName: "Ana" },
  { userId: "luis", email: "luis@x.io", isOwner: false, displayName: "Luis" },
];
const ALL = MEMBERS.map((m) => m.userId);

function expenseRow(id: string, overrides: Record<string, unknown>) {
  const { paid_by = "hernan", ...rest } = overrides as Record<string, unknown> & { paid_by?: string };
  return {
    id,
    trip_id: TRIP,
    activity_id: null,
    title: id,
    amount_cents: 0,
    currency: "EUR",
    spent_on: "2026-11-02",
    category: "other",
    split_method: "equal",
    notes: null,
    receipt_path: null,
    created_by: "hernan",
    created_at: "2026-11-02T10:00:00Z",
    updated_at: "2026-11-02T10:00:00Z",
    expense_splits: [],
    ...rest,
    // One payer of the whole amount unless the test gives the payers.
    expense_payers: rest.expense_payers ?? [{ user_id: paid_by, paid_cents: rest.amount_cents ?? 0 }],
  };
}

const lodging = expenseRow("lodging", {
  title: "Apartamento",
  amount_cents: 50000,
  category: "lodging",
  expense_splits: [
    { user_id: "hernan", share_cents: 16667, percent_bp: null },
    { user_id: "maria", share_cents: 16667, percent_bp: null },
    { user_id: "jack", share_cents: 16666, percent_bp: null },
  ],
});
const dinner = expenseRow("dinner", {
  title: "Cena",
  amount_cents: 10000,
  category: "food",
  spent_on: "2026-11-03",
  paid_by: "maria",
  created_by: "maria",
  expense_splits: ALL.map((user_id) => ({ user_id, share_cents: 2000, percent_bp: null })),
});

async function show(options: { expenses?: unknown[]; me?: string; expensesError?: DbError } = {}) {
  db.tables.expenses = { data: options.expensesError ? null : options.expenses ?? [], error: options.expensesError ?? null };
  useItineraryStore.setState({ loadTripMembers: vi.fn(async () => ({ members: MEMBERS })) } as never);
  useAuthStore.setState({ user: { id: options.me ?? "hernan", is_anonymous: false } } as never);
  renderWithI18n(<ExpensesView tripId={TRIP} ownerId="hernan" currency="EUR" />);
  await act(async () => {});
}

const text = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
const cellsOf = (row: HTMLElement) => [within(row).getByRole("rowheader"), ...within(row).getAllByRole("cell")].map((cell) => text(cell)).join(" ");
const balanceRow = (name: string) => {
  const table = screen.getByRole("table", { name: /Saldos/ });
  const row = within(table).getAllByRole("row").find((r) => within(r).queryByRole("rowheader")?.textContent?.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return cellsOf(row);
};
const rpcCalls = (fn: string) => db.log.filter((entry) => entry[0] === "rpc" && entry[1] === fn);

beforeEach(() => {
  mockMatchMedia();
  clearTripMembersCache();
  clearTripExpensesCache();
  window.localStorage.clear();
  db.tables = {};
  db.rpc = { save_expense: { data: "new-id", error: null } };
  db.log = [];
  useOfflineStore.setState({ isOnline: true } as never);
});
afterEach(() => cleanup());

describe("ExpensesView", () => {
  it("shows what each person paid, their share and their balance", async () => {
    await show({ expenses: [lodging] });
    expect(balanceRow("Hernán")).toBe("Hernán 500,00 € 166,67 € +333,33 €");
    expect(balanceRow("María")).toBe("María 0,00 € 166,67 € -166,67 €");
    expect(balanceRow("Jack")).toBe("Jack 0,00 € 166,66 € -166,66 €");
    expect(balanceRow("Ana")).toBe("Ana 0,00 € 0,00 € 0,00 €");
    expect(text(screen.getByTestId("expenses-total"))).toContain("500,00 €");
  });

  it("lists the simplified payments and records one as settled", async () => {
    await show({ expenses: [lodging, dinner] });
    expect(balanceRow("Hernán")).toBe("Hernán 500,00 € 186,67 € +313,33 €");
    const debts = screen.getByRole("list", { name: "Quién debe a quién" });
    expect(within(debts).getAllByRole("listitem").map((item) => text(item).replace(/\s*Marcar como saldada$/, ""))).toEqual([
      "Jack → Hernán 186,66 €",
      "María → Hernán 86,67 €",
      "Ana → Hernán 20,00 €",
      "Luis → Hernán 20,00 €",
    ]);

    fireEvent.click(within(debts).getAllByRole("button", { name: /Marcar como saldada/ })[0]);
    await act(async () => {});
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Marcar como saldada" }));
    await act(async () => {});

    const insert = db.log.find((entry) => entry[0] === "expense_settlements.insert");
    expect(insert?.[1]).toEqual([expect.objectContaining({ trip_id: TRIP, from_user: "jack", to_user: "hernan", amount_cents: 18666, currency: "EUR" })]);
    // The view loads again after the write.
    expect(db.log.filter((entry) => entry[0] === "expenses.select").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a debt with a former member read-only (settlements need two current members)", async () => {
    const old = expenseRow("old", {
      title: "Tren",
      amount_cents: 4000,
      expense_splits: [
        { user_id: "hernan", share_cents: 2000, percent_bp: null },
        { user_id: "gone", share_cents: 2000, percent_bp: null },
      ],
    });
    await show({ expenses: [old] });
    const debts = screen.getByRole("list", { name: "Quién debe a quién" });
    const [item] = within(debts).getAllByRole("listitem");
    expect(text(item)).toContain("Exmiembro → Hernán 20,00 €");
    expect(within(item).queryByRole("button")).toBeNull();
    expect(balanceRow("Exmiembro")).toBe("Exmiembro 0,00 € 20,00 € -20,00 €");
  });

  it("creates an expense with splits that add up to the amount", async () => {
    await show({ expenses: [lodging] });
    fireEvent.click(screen.getAllByRole("button", { name: "Añadir gasto" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    fireEvent.change(within(dialog).getByLabelText("Concepto"), { target: { value: "Taxi" } });
    fireEvent.change(within(dialog).getByLabelText("Importe"), { target: { value: "31" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Transporte" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar gasto" }));
    await act(async () => {});

    const [call] = rpcCalls("save_expense");
    const args = call[2] as { p_expense: Record<string, unknown>; p_splits: { user_id: string; share_cents: number }[] };
    expect(args.p_expense).toMatchObject({ trip_id: TRIP, title: "Taxi", amount_cents: 3100, currency: "EUR", category: "transport", split_method: "equal" });
    expect(args.p_expense).not.toHaveProperty("paid_by");
    expect((call[2] as { p_payers: unknown }).p_payers).toEqual([{ user_id: "hernan", paid_cents: 3100 }]);
    expect(args.p_expense).not.toHaveProperty("id");
    expect(args.p_splits.map((s) => s.user_id)).toEqual(ALL);
    expect(args.p_splits.reduce((sum, s) => sum + s.share_cents, 0)).toBe(3100);
    expect(screen.queryByRole("dialog", { name: "Nuevo gasto" })).toBeNull();
  });

  it("splits who paid among several payers, equally or by amounts", async () => {
    await show();
    fireEvent.click(screen.getAllByRole("button", { name: "Añadir gasto" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    fireEvent.change(within(dialog).getByLabelText("Concepto"), { target: { value: "Hotel" } });
    fireEvent.change(within(dialog).getByLabelText("Importe"), { target: { value: "300" } });
    const payers = within(dialog).getByRole("group", { name: "Pagado por" });
    // The last payer cannot be removed.
    fireEvent.click(within(payers).getByRole("checkbox", { name: /Hernán/ }));
    expect((within(payers).getByRole("checkbox", { name: /Hernán/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(payers).getByRole("checkbox", { name: /Jack/ }));
    expect(text(payers)).toContain("150,00 €");

    fireEvent.click(within(payers).getByRole("radio", { name: "Importes" }));
    fireEvent.change(within(payers).getByLabelText("Importe que pagó Hernán"), { target: { value: "200" } });
    const save = within(dialog).getByRole("button", { name: "Guardar gasto" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(text(within(payers).getByRole("status"))).toContain("Falta 100,00 €");
    fireEvent.change(within(payers).getByLabelText("Importe que pagó Jack"), { target: { value: "100" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await act(async () => {});
    const args = rpcCalls("save_expense")[0][2] as { p_payers: unknown[]; p_splits: { share_cents: number }[] };
    expect(args.p_payers).toEqual([
      { user_id: "hernan", paid_cents: 20000 },
      { user_id: "jack", paid_cents: 10000 },
    ]);
    expect(args.p_splits.reduce((sum, split) => sum + split.share_cents, 0)).toBe(30000);
  });

  it("names every payer in the list and keeps their amounts when editing", async () => {
    const hotel = expenseRow("hotel", {
      title: "Hotel",
      amount_cents: 30000,
      category: "lodging",
      expense_payers: [
        { user_id: "hernan", paid_cents: 20000 },
        { user_id: "jack", paid_cents: 10000 },
      ],
      expense_splits: ["hernan", "jack", "maria"].map((user_id) => ({ user_id, share_cents: 10000, percent_bp: null })),
    });
    await show({ expenses: [hotel] });
    const row = screen.getByRole("button", { name: /Hotel/ });
    expect(text(row)).toContain("Pagaron Hernán y Jack");
    fireEvent.click(row);
    const dialog = screen.getByRole("dialog", { name: "Editar gasto" });
    expect((within(dialog).getByLabelText("Importe que pagó Hernán") as HTMLInputElement).value).toBe("200,00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar gasto" }));
    await act(async () => {});
    const args = rpcCalls("save_expense")[0][2] as { p_payers: unknown[] };
    expect(args.p_payers).toEqual([
      { user_id: "hernan", paid_cents: 20000 },
      { user_id: "jack", paid_cents: 10000 },
    ]);
  });

  it("excludes people from a split", async () => {
    await show();
    fireEvent.click(screen.getAllByRole("button", { name: "Añadir gasto" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    fireEvent.change(within(dialog).getByLabelText("Concepto"), { target: { value: "Museo" } });
    fireEvent.change(within(dialog).getByLabelText("Importe"), { target: { value: "30" } });
    const people = within(dialog).getByRole("group", { name: "Entre quiénes" });
    fireEvent.click(within(people).getByRole("checkbox", { name: /Ana/ }));
    fireEvent.click(within(people).getByRole("checkbox", { name: /Luis/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar gasto" }));
    await act(async () => {});
    const args = rpcCalls("save_expense")[0][2] as { p_splits: { user_id: string; share_cents: number }[] };
    expect(args.p_splits).toEqual([
      { user_id: "hernan", share_cents: 1000, percent_bp: null },
      { user_id: "maria", share_cents: 1000, percent_bp: null },
      { user_id: "jack", share_cents: 1000, percent_bp: null },
    ]);
  });

  it("blocks a percent split that does not add up to 100 %", async () => {
    await show();
    fireEvent.click(screen.getAllByRole("button", { name: "Añadir gasto" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    fireEvent.change(within(dialog).getByLabelText("Concepto"), { target: { value: "Cena" } });
    fireEvent.change(within(dialog).getByLabelText("Importe"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Porcentajes" }));
    fireEvent.change(within(dialog).getByLabelText("Porcentaje de Hernán"), { target: { value: "50" } });
    fireEvent.change(within(dialog).getByLabelText("Porcentaje de María"), { target: { value: "40" } });

    const save = within(dialog).getByRole("button", { name: "Guardar gasto" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(text(within(dialog).getByRole("status"))).toContain("Falta 10 %");
    fireEvent.click(save);
    await act(async () => {});
    expect(rpcCalls("save_expense")).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("Porcentaje de María"), { target: { value: "50" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await act(async () => {});
    const args = rpcCalls("save_expense")[0][2] as { p_expense: Record<string, unknown>; p_splits: unknown[] };
    expect(args.p_expense.split_method).toBe("percent");
    expect(args.p_splits).toEqual([
      { user_id: "hernan", share_cents: 5000, percent_bp: 5000 },
      { user_id: "maria", share_cents: 5000, percent_bp: 5000 },
    ]);
  });

  it("lets only the creator or the trip owner edit or delete an expense", async () => {
    await show({ expenses: [lodging, dinner], me: "maria" });
    fireEvent.click(screen.getByRole("button", { name: /Apartamento/ }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Guardar gasto" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Eliminar gasto" })).toBeNull();
    expect((within(dialog).getByLabelText("Concepto") as HTMLInputElement).disabled).toBe(true);
    expect(text(dialog)).toContain("Solo quien lo registró o el organizador del viaje puede cambiarlo.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));

    fireEvent.click(screen.getByRole("button", { name: /Cena/ }));
    dialog = screen.getByRole("dialog", { name: "Editar gasto" });
    expect(within(dialog).getByRole("button", { name: "Guardar gasto" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Eliminar gasto" })).toBeTruthy();
  });

  it("edits an expense through save_expense with its id", async () => {
    await show({ expenses: [lodging] });
    fireEvent.click(screen.getByRole("button", { name: /Apartamento/ }));
    const dialog = screen.getByRole("dialog", { name: "Editar gasto" });
    fireEvent.change(within(dialog).getByLabelText("Concepto"), { target: { value: "Apartamento centro" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar gasto" }));
    await act(async () => {});
    const args = rpcCalls("save_expense")[0][2] as { p_expense: Record<string, unknown>; p_splits: { share_cents: number }[] };
    expect(args.p_expense).toMatchObject({ id: "lodging", title: "Apartamento centro", amount_cents: 50000 });
    expect(args.p_splits.map((s) => s.share_cents)).toEqual([16667, 16667, 16666]);
  });

  it("shows a friendly empty state with the add action", async () => {
    await show();
    expect(screen.getByText("Todavía no hay gastos")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Añadir gasto" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a not-available-yet state when the tables do not exist", async () => {
    await show({ expensesError: { code: "42P01", message: 'relation "expenses" does not exist' } });
    expect(screen.getByText("Los gastos todavía no están disponibles")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Añadir gasto" })).toBeNull();
  });

  it("is read-only offline", async () => {
    useOfflineStore.setState({ isOnline: false } as never);
    await show({ expenses: [lodging] });
    expect(screen.getByText(/Sin conexión/)).toBeTruthy();
  });
});
