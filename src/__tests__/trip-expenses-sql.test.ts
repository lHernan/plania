import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// SQL cannot run here: these checks pin the invariants of the hand-run migration as text.
// Whitespace is collapsed, and dropped just inside parentheses so multi-line clauses read as one line.
const read = (file: string) =>
  readFileSync(path.resolve(__dirname, "../lib", file), "utf8")
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")");
const sql = read("trip_expenses_migration.sql");
const transfer = read("transfer_anon_data.sql");
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function policy(name: string, table: string): string {
  const match = sql.match(new RegExp(`CREATE POLICY "${name}" ON ${table.replace(".", "\\.")} (.*?);`));
  expect(match, `policy ${name}`).not.toBeNull();
  return match![1];
}

function fn(name: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\((.*?)\\$\\$;`));
  expect(match, `function ${name}`).not.toBeNull();
  return match![1];
}

function table(name: string): string {
  const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\((.*?)\\);`));
  expect(match, `table ${name}`).not.toBeNull();
  return match![1];
}

const POLICIES: [string, string, string][] = [
  ["expenses_select", "expenses", "SELECT"],
  ["expenses_delete", "expenses", "DELETE"],
  ["expense_splits_select", "expense_splits", "SELECT"],
  ["expense_settlements_select", "expense_settlements", "SELECT"],
  ["expense_settlements_insert", "expense_settlements", "INSERT"],
  ["expense_settlements_delete", "expense_settlements", "DELETE"],
  ["trip_receipts_select", "storage.objects", "SELECT"],
  ["trip_receipts_insert", "storage.objects", "INSERT"],
  ["trip_receipts_update", "storage.objects", "UPDATE"],
  ["trip_receipts_delete", "storage.objects", "DELETE"],
];

const MEMBER = (column: string) =>
  `EXISTS (SELECT 1 FROM trips t WHERE t.id = ${column} AND t.user_id = p_new_id) OR EXISTS (SELECT 1 FROM trip_shares s WHERE s.trip_id = ${column} AND s.shared_with = p_new_id)`;

describe("trip_expenses migration: tables", () => {
  it("creates the three tables idempotently and never drops anything", () => {
    for (const name of ["expenses", "expense_splits", "expense_settlements"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${name} (`);
      expect(sql).toContain(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;`);
    }
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DROP FUNCTION/);
  });

  it("stores an expense in cents with bounded, checked fields", () => {
    const t = table("expenses");
    expect(t).toContain("id UUID PRIMARY KEY DEFAULT gen_random_uuid()");
    expect(t).toContain("trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE");
    expect(t).toContain("activity_id UUID REFERENCES activities(id) ON DELETE SET NULL");
    expect(t).toContain("title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200)");
    expect(t).toContain("amount_cents BIGINT NOT NULL CHECK (amount_cents > 0)");
    expect(t).toContain("currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$')");
    expect(t).toContain("spent_on DATE NOT NULL");
    expect(t).toContain(
      "category TEXT NOT NULL CHECK (category IN ('flights', 'lodging', 'transport', 'food', 'activities', 'shopping', 'other'))"
    );
    expect(t).toContain("paid_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT");
    expect(t).toContain("split_method TEXT NOT NULL CHECK (split_method IN ('equal', 'exact', 'percent', 'individual'))");
    expect(t).toContain("notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000)");
    expect(t).toContain("receipt_path TEXT");
    expect(t).toContain("created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT");
    expect(t).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    expect(t).toContain("updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    // A stored receipt always lives in its own trip and expense folder.
    expect(t).toContain(`receipt_path ~ ('^' || trip_id::text || '/' || id::text || '/${UUID}\\.(jpg|png|webp)$')`);
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_expenses_trip_spent_on ON expenses(trip_id, spent_on DESC)");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_expenses_activity ON expenses(activity_id)");
  });

  it("keys splits by expense and person, embeddable from expenses, never cascading from a person", () => {
    const t = table("expense_splits");
    expect(t).toContain("expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE");
    expect(t).toContain("user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT");
    expect(t).toContain("share_cents BIGINT NOT NULL CHECK (share_cents >= 0)");
    expect(t).toContain("percent_bp INTEGER CHECK (percent_bp IS NULL OR percent_bp BETWEEN 0 AND 10000)");
    expect(t).toContain("PRIMARY KEY (expense_id, user_id)");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id)");
  });

  it("records settlements between two different people of a trip", () => {
    const t = table("expense_settlements");
    expect(t).toContain("id UUID PRIMARY KEY DEFAULT gen_random_uuid()");
    expect(t).toContain("trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE");
    expect(t).toContain("from_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT");
    expect(t).toContain("to_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT");
    expect(t).toContain("amount_cents BIGINT NOT NULL CHECK (amount_cents > 0)");
    expect(t).toContain("currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$')");
    expect(t).toContain("settled_on DATE NOT NULL DEFAULT CURRENT_DATE");
    expect(t).toContain("note TEXT CHECK (note IS NULL OR char_length(note) <= 500)");
    expect(t).toContain("created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT");
    expect(t).toContain("CHECK (from_user <> to_user)");
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_expense_settlements_trip_settled_on ON expense_settlements(trip_id, settled_on DESC)"
    );
  });
});

describe("trip_expenses migration: triggers", () => {
  it("only accepts an activity of the expense's own trip", () => {
    const body = fn("expenses_check_activity");
    expect(body).toContain("SECURITY DEFINER SET search_path = public");
    expect(body).toContain("SELECT 1 FROM activities WHERE id = NEW.activity_id AND trip_id = NEW.trip_id");
    expect(body).toContain("USING ERRCODE = '23514'");
    expect(sql).toContain("CREATE TRIGGER expenses_check_activity BEFORE INSERT OR UPDATE ON expenses");
  });

  it("keeps updated_at and never moves an expense to another trip or creator outside the transfer", () => {
    const body = fn("expenses_before_update");
    expect(body).toMatch(/IF NEW\.trip_id IS DISTINCT FROM OLD\.trip_id THEN RAISE EXCEPTION/);
    expect(body).toContain(
      "IF NEW.created_by IS DISTINCT FROM OLD.created_by AND current_setting('plania.expenses_transfer', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION"
    );
    expect(body).toContain("NEW.updated_at := NOW()");
    expect(sql).toContain("CREATE TRIGGER expenses_before_update BEFORE UPDATE ON expenses");
  });

  it("only records settlements between members of the trip", () => {
    const body = fn("expense_settlements_before_insert");
    expect(body).toContain("SECURITY DEFINER SET search_path = public");
    for (const column of ["from_user", "to_user"]) {
      expect(body).toContain(`trips WHERE id = NEW.trip_id AND user_id = NEW.${column}`);
      expect(body).toContain(`trip_shares WHERE trip_id = NEW.trip_id AND shared_with = NEW.${column}`);
    }
    expect(body).toContain("USING ERRCODE = '23514'");
    expect(sql).toContain("CREATE TRIGGER expense_settlements_before_insert BEFORE INSERT ON expense_settlements");
  });
});

describe("trip_expenses migration: save_expense", () => {
  const body = () => fn("save_expense");

  it("is the only way to write expenses and splits, as a definer RPC for signed-in users", () => {
    expect(body()).toMatch(/^p_expense JSONB, p_splits JSONB\) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION save_expense(JSONB, JSONB) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION save_expense(JSONB, JSONB) TO authenticated;");
    expect(sql).not.toMatch(/CREATE POLICY "\w+" ON (expenses|expense_splits) FOR (INSERT|UPDATE|ALL)/);
  });

  it("requires the caller and the payer to be members of the trip", () => {
    expect(body()).toMatch(/IF v_trip IS NULL OR NOT is_trip_member\(v_trip, auth\.uid\(\)\) THEN RAISE EXCEPTION .*? USING ERRCODE = '42501'/);
    expect(body()).toMatch(/NOT is_trip_member\(v_trip, v_paid_by\)/);
  });

  it("rejects splits that are empty, duplicated, of non-members or that do not add up", () => {
    const b = body();
    expect(b).toContain("jsonb_typeof(p_splits) IS DISTINCT FROM 'array'");
    expect(b).toContain("v_count = 0");
    expect(b).toContain("v_distinct <> v_count");
    expect(b).toContain("v_sum IS DISTINCT FROM v_amount");
    // New split users must be members; a former member already on this expense may stay.
    expect(b).toMatch(
      /WHERE NOT is_trip_member\(v_trip, s\.user_id\) AND NOT \(v_id IS NOT NULL AND EXISTS \(SELECT 1 FROM expense_splits e WHERE e\.expense_id = v_id AND e\.user_id = s\.user_id\)\)/
    );
    expect(b.match(/USING ERRCODE = '23514'/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("enforces the rules of the individual and percent methods", () => {
    const b = body();
    expect(b).toContain("v_method = 'individual' AND v_count <> 1");
    expect(b).toContain("v_method = 'percent' AND (v_with_percent <> v_count OR v_percent_sum <> 10000)");
    expect(b).toContain("CASE WHEN v_method = 'percent' THEN s.percent_bp END");
  });

  it("lets only the creator or the trip owner edit, never moving the expense to another trip", () => {
    const b = body();
    expect(b).toContain("SELECT * INTO v_existing FROM expenses WHERE id = v_id FOR UPDATE");
    expect(b).toMatch(/IF NOT FOUND THEN RAISE EXCEPTION .*? USING ERRCODE = 'P0002'/);
    expect(b).toMatch(/IF v_existing\.trip_id IS DISTINCT FROM v_trip THEN RAISE EXCEPTION .*? USING ERRCODE = '23514'/);
    expect(b).toMatch(/IF NOT \(v_existing\.created_by = auth\.uid\(\) OR is_trip_owner\(v_trip\)\) THEN RAISE EXCEPTION .*? USING ERRCODE = '42501'/);
    // A former member who already paid this expense may stay its payer.
    expect(b).toContain("v_paid_by IS DISTINCT FROM v_existing.paid_by");
  });

  it("creates with the caller as creator and replaces the splits atomically", () => {
    const b = body();
    expect(b).toMatch(/INSERT INTO expenses \(trip_id, activity_id, title, amount_cents, currency, spent_on, category, paid_by, split_method, notes, created_by\) VALUES \(v_trip, .*?, auth\.uid\(\)\) RETURNING id INTO v_id/);
    expect(b).toContain("DELETE FROM expense_splits WHERE expense_id = v_id");
    expect(b).toContain("INSERT INTO expense_splits (expense_id, user_id, share_cents, percent_bp)");
    expect(b.indexOf("DELETE FROM expense_splits")).toBeLessThan(b.indexOf("INSERT INTO expense_splits"));
    expect(b).not.toMatch(/UPDATE expenses SET [^;]*(trip_id|created_by|receipt_path) =/);
  });
});

describe("trip_expenses migration: receipts", () => {
  it("sets or clears a receipt path only for the creator or the owner, in the expense's own folder", () => {
    const body = fn("set_expense_receipt");
    expect(body).toMatch(/^p_expense_id UUID, p_path TEXT\) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/);
    expect(body).toContain("NOT (is_trip_member(v_expense.trip_id, auth.uid()) AND (v_expense.created_by = auth.uid() OR is_trip_owner(v_expense.trip_id)))");
    expect(body).toContain(`p_path IS NOT NULL AND p_path !~ ('^' || v_expense.trip_id::text || '/' || v_expense.id::text || '/${UUID}\\.(jpg|png|webp)$')`);
    expect(body).toContain("UPDATE expenses SET receipt_path = p_path WHERE id = p_expense_id");
    expect(sql).toContain("REVOKE ALL ON FUNCTION set_expense_receipt(UUID, TEXT) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION set_expense_receipt(UUID, TEXT) TO authenticated;");
  });

  it("creates the private, limited bucket", () => {
    expect(sql).toContain(
      "INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('trip-receipts', 'trip-receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']) ON CONFLICT (id) DO UPDATE SET public = false"
    );
  });

  it("validates the object name before any cast", () => {
    for (const name of ["can_read_expense_object", "can_write_expense_object"]) {
      const body = fn(name);
      expect(body).toContain("SECURITY DEFINER SET search_path = public");
      expect(body).toContain("IF p_name IS NULL OR p_name !~ ('^' || v_uuid || '/' || v_uuid || '/' || v_uuid || '\\.(jpg|png|webp)$') THEN RETURN false;");
      expect(body.indexOf("RETURN false")).toBeLessThan(body.indexOf("::uuid"));
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${name}(TEXT) TO authenticated;`);
    }
    expect(fn("can_read_expense_object")).toContain("is_trip_member(v_folders[1]::uuid, auth.uid())");
    const write = fn("can_write_expense_object");
    expect(write).toContain("WHERE e.id = v_folders[2]::uuid AND e.trip_id = v_folders[1]::uuid");
    expect(write).toContain("(e.created_by = auth.uid() OR is_trip_owner(e.trip_id)) AND is_trip_member(e.trip_id, auth.uid())");
  });

  it("lets members read receipts and only the creator or owner write them", () => {
    expect(policy("trip_receipts_select", "storage.objects")).toContain("bucket_id = 'trip-receipts' AND can_read_expense_object(name)");
    for (const name of ["trip_receipts_insert", "trip_receipts_update", "trip_receipts_delete"]) {
      expect(policy(name, "storage.objects")).toContain("bucket_id = 'trip-receipts' AND can_write_expense_object(name)");
    }
  });
});

describe("trip_expenses migration: row level security", () => {
  it("applies every policy to signed-in users only and grants nothing to anon", () => {
    for (const [name, on, command] of POLICIES) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${name}" ON ${on};`);
      expect(policy(name, on)).toMatch(new RegExp(`^FOR ${command} TO authenticated `));
    }
    expect(sql.match(/CREATE POLICY/g)).toHaveLength(POLICIES.length);
    expect(sql).not.toMatch(/TO anon\b|TO public\b/i);
  });

  it("lets members read expenses and their splits", () => {
    expect(policy("expenses_select", "expenses")).toContain("USING (is_trip_member(trip_id, auth.uid()))");
    expect(policy("expense_splits_select", "expense_splits")).toContain("USING (can_see_expense(expense_id))");
    const body = fn("can_see_expense");
    expect(body).toContain("SECURITY DEFINER SET search_path = public");
    expect(body).toContain("e.id = p_expense_id AND is_trip_member(e.trip_id, auth.uid())");
  });

  it("lets the creator or the owner delete, while still a member", () => {
    expect(policy("expenses_delete", "expenses")).toContain(
      "USING ((created_by = auth.uid() OR is_trip_owner(trip_id)) AND is_trip_member(trip_id, auth.uid()))"
    );
    expect(policy("expense_settlements_delete", "expense_settlements")).toContain(
      "USING ((created_by = auth.uid() OR is_trip_owner(trip_id)) AND is_trip_member(trip_id, auth.uid()))"
    );
  });

  it("lets members record settlements as themselves and never edit them", () => {
    expect(policy("expense_settlements_select", "expense_settlements")).toContain("USING (is_trip_member(trip_id, auth.uid()))");
    expect(policy("expense_settlements_insert", "expense_settlements")).toContain(
      "WITH CHECK (created_by = auth.uid() AND is_trip_member(trip_id, auth.uid()))"
    );
    expect(sql).not.toMatch(/CREATE POLICY "\w+" ON expense_settlements FOR UPDATE/);
  });
});

describe("trip_expenses migration: realtime", () => {
  it("publishes the three tables once, skipping a missing publication", () => {
    expect(sql).toContain("IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN RETURN;");
    expect(sql).toContain("FOREACH v_table IN ARRAY ARRAY['expenses', 'expense_splits', 'expense_settlements'] LOOP");
    expect(sql).toContain(
      "IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);"
    );
  });
});

describe("transfer_anonymous_data: expenses", () => {
  const after = (needle: string) => {
    expect(transfer).toContain(needle);
    expect(transfer.indexOf(needle)).toBeGreaterThan(transfer.indexOf("UPDATE trips SET user_id = p_new_id"));
  };

  it("re-points expenses only on trips the new account belongs to, with the creator flag", () => {
    expect(transfer).toContain("IF to_regclass('public.expenses') IS NOT NULL THEN");
    after("PERFORM set_config('plania.expenses_transfer', 'on', true);");
    after(`UPDATE expenses e SET paid_by = p_new_id WHERE e.paid_by = p_anon_id AND (${MEMBER("e.trip_id")});`);
    after(`UPDATE expenses e SET created_by = p_new_id WHERE e.created_by = p_anon_id AND (${MEMBER("e.trip_id")});`);
    expect(transfer.indexOf("set_config('plania.expenses_transfer', 'on', true)")).toBeLessThan(
      transfer.indexOf("UPDATE expenses e SET created_by")
    );
    expect(transfer.indexOf("set_config('plania.expenses_transfer', 'off', true)")).toBeGreaterThan(
      transfer.indexOf("UPDATE expenses e SET created_by")
    );
  });

  it("re-points splits without colliding with an existing split of the new account", () => {
    expect(transfer).toContain("IF to_regclass('public.expense_splits') IS NOT NULL THEN");
    after("UPDATE expense_splits x SET user_id = p_new_id WHERE x.user_id = p_anon_id");
    expect(transfer).toContain(`EXISTS (SELECT 1 FROM expenses e WHERE e.id = x.expense_id AND (${MEMBER("e.trip_id")}))`);
    expect(transfer).toContain("NOT EXISTS (SELECT 1 FROM expense_splits b WHERE b.expense_id = x.expense_id AND b.user_id = p_new_id)");
  });

  it("re-points settlements without ever making from_user equal to_user", () => {
    expect(transfer).toContain("IF to_regclass('public.expense_settlements') IS NOT NULL THEN");
    after(`UPDATE expense_settlements x SET from_user = p_new_id WHERE x.from_user = p_anon_id AND x.to_user <> p_new_id AND (${MEMBER("x.trip_id")});`);
    after(`UPDATE expense_settlements x SET to_user = p_new_id WHERE x.to_user = p_anon_id AND x.from_user <> p_new_id AND (${MEMBER("x.trip_id")});`);
    after(`UPDATE expense_settlements x SET created_by = p_new_id WHERE x.created_by = p_anon_id AND (${MEMBER("x.trip_id")});`);
  });

  it("never deletes money rows", () => {
    expect(transfer).not.toMatch(/DELETE FROM (expenses|expense_splits|expense_settlements)\b/);
  });
});
