import { compressImage } from "@/lib/image-compress";
import { createSignedUrlCache, type SignedUrlClient } from "@/lib/signed-url-cache";
import { mapExpenseError, type ExpenseError, type ExpensesClient } from "./sync";

/** Private bucket of receipt photos; objects live at `<tripId>/<expenseId>/<uuid>.<ext>`. */
export const TRIP_RECEIPTS_BUCKET = "trip-receipts";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
/** Image types the bucket accepts, with the extension the path policy expects. */
export const RECEIPT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const RECEIPT_ACCEPT = Object.keys(RECEIPT_TYPES).join(",");
export const RECEIPT_URL_SECONDS = 3600;

export function validateReceiptFile(file: Pick<File, "type" | "size">): "type" | "size" | null {
  if (!RECEIPT_TYPES[file.type]) return "type";
  if (file.size > RECEIPT_MAX_BYTES) return "size";
  return null;
}

/** `<tripId>/<expenseId>/<uuid>.<jpg|png|webp>`, lowercase as the database check requires. */
export function receiptObjectPath(tripId: string, expenseId: string, type: string, id: string = crypto.randomUUID()): string {
  return `${tripId}/${expenseId}/${id.toLowerCase()}.${RECEIPT_TYPES[type] ?? "jpg"}`;
}

const rpcError = async (client: ExpensesClient, expenseId: string, path: string | null): Promise<ExpenseError | undefined> => {
  try {
    const { error } = await client.rpc("set_expense_receipt", { p_expense_id: expenseId, p_path: path });
    return error ? mapExpenseError(error) : undefined;
  } catch {
    return "failed";
  }
};

/** Best effort: an object left behind only costs storage. */
async function removeObject(client: ExpensesClient, path: string): Promise<void> {
  try {
    await client.storage.from(TRIP_RECEIPTS_BUCKET).remove([path]);
  } catch (error) {
    console.error("Tachao: receipt cleanup error", error);
  }
}

/**
 * Compresses and uploads a receipt photo, then attaches it to the expense. The new object is
 * removed when attaching fails; the previous receipt's object is removed once replaced.
 */
export async function uploadReceipt(
  client: ExpensesClient,
  input: { tripId: string; expenseId: string; file: File; previousPath?: string | null },
): Promise<{ path?: string; error?: ExpenseError }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { error: "offline" };
  if (!RECEIPT_TYPES[input.file.type]) return { error: "invalid" };
  const file = await compressImage(input.file);
  if (validateReceiptFile(file)) return { error: "invalid" };
  const path = receiptObjectPath(input.tripId, input.expenseId, file.type);
  try {
    const { error } = await client.storage.from(TRIP_RECEIPTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
    if (error) return { error: "failed" };
  } catch {
    return { error: "failed" };
  }
  const attachError = await rpcError(client, input.expenseId, path);
  if (attachError) {
    await removeObject(client, path);
    return { error: attachError };
  }
  if (input.previousPath && input.previousPath !== path) await removeObject(client, input.previousPath);
  return { path };
}

/** Detaches the receipt from the expense, then removes its object. */
export async function removeReceipt(client: ExpensesClient, input: { expenseId: string; path: string }): Promise<{ error?: ExpenseError }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { error: "offline" };
  const error = await rpcError(client, input.expenseId, null);
  if (error) return { error };
  await removeObject(client, input.path);
  return {};
}

const urls = createSignedUrlCache(TRIP_RECEIPTS_BUCKET, RECEIPT_URL_SECONDS);

/** A signed URL to view a receipt; null offline, on error or when the caller may not see it. */
export const resolveReceiptUrl = (path: string, client: SignedUrlClient) => urls.resolve(path, client);
export const getCachedReceiptUrl = (path: string) => urls.getCached(path);
export const forgetReceiptUrl = (path: string) => urls.forget(path);
