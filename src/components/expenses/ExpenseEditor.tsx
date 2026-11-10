"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MemberAvatar } from "@/components/members/MemberAvatar";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { currencyDecimals, formatCents, parseAmountToCents } from "@/lib/expenses/money";
import { RECEIPT_ACCEPT, removeReceipt, resolveReceiptUrl, uploadReceipt } from "@/lib/expenses/receipts";
import { computePayers, computeSplits, type PayerMode } from "@/lib/expenses/splits";
import { deleteExpense, saveExpense, type ExpenseError, type ExpensesClient } from "@/lib/expenses/sync";
import type { ActivityOptionGroup } from "@/lib/expenses/activity-link";
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type SplitMethod } from "@/lib/expenses/types";
import { currencyChoices } from "@/lib/trip-currency";
import type { TripMember } from "@/lib/types";
import { CATEGORY_ICONS, CATEGORY_KEYS, ERROR_KEYS, METHOD_KEYS, SPLIT_ERROR_KEYS, formatDay, personNamer, todayIso } from "./expense-ui";

type ExpenseEditorProps = {
  client: ExpensesClient;
  tripId: string;
  /** Default currency of a new expense (the trip's). */
  currency: string;
  members: TripMember[];
  currentUserId: string;
  /** The expense to show or edit; omitted to create one. */
  expense?: Expense;
  /** The trip activities an expense can be linked to (optional), by day. */
  activityGroups?: ActivityOptionGroup[];
  /** Starting values of a new expense (one added from an activity). */
  prefill?: { activityId: string; title: string; category: ExpenseCategory };
  /** Creator or trip owner; others see the expense read-only. */
  canEdit: boolean;
  online: boolean;
  /** After any write, so the list reloads. */
  onSaved: () => void;
  onClose: () => void;
};

const METHODS: SplitMethod[] = ["equal", "exact", "percent", "individual"];
const fieldLabel = "text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]";
const inputClass =
  "w-full min-h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-70";
const chipClass = (selected: boolean) =>
  `min-h-11 inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)] has-[:disabled]:cursor-default ${
    selected
      ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/40"
  }`;

/** Cents as the text of an amount field: "500,00" in Spanish, "500.00" in English. */
function centsToText(cents: number, currency: string, lang: string): string {
  const decimals = currencyDecimals(currency);
  const text = (cents / 10 ** decimals).toFixed(decimals);
  return lang === "es" ? text.replace(".", ",") : text;
}

/** Percent text to basis points ("33,33" -> 3333); EUR stands in for any 2-decimal parse. */
const percentTextToBp = (text: string) => (text.trim() ? parseAmountToCents(text, "EUR") : 0);

/** Sheet to create, edit or (read-only) view an expense, its split and its receipt. */
export function ExpenseEditor({
  client,
  tripId,
  currency: tripCurrency,
  members,
  currentUserId,
  expense,
  activityGroups = [],
  prefill,
  canEdit,
  online,
  onSaved,
  onClose,
}: ExpenseEditorProps) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const ids = { title: useId(), amount: useId(), currency: useId(), date: useId(), activity: useId(), notes: useId() };
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const fileRef = useRef<HTMLInputElement>(null);

  // Members first, then former members still on this expense (they can stay, never be added).
  const peopleIds = useMemo(() => {
    const memberIds = members.map((member) => member.userId);
    const former = expense ? [...expense.payers.map((payer) => payer.userId), ...expense.splits.map((split) => split.userId)].filter((id) => !memberIds.includes(id)) : [];
    return [...memberIds, ...new Set(former)];
  }, [members, expense]);
  const people = personNamer(members, t("expenses_former_member"));

  const [savedId, setSavedId] = useState<string | null>(expense?.id ?? null);
  const [title, setTitle] = useState(expense?.title ?? prefill?.title ?? "");
  const [currency, setCurrency] = useState(expense?.currency ?? tripCurrency);
  const [amountText, setAmountText] = useState(expense ? centsToText(expense.amountCents, expense.currency, lang) : "");
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? todayIso());
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? prefill?.category ?? "other");
  const [activityId, setActivityId] = useState<string | null>(expense ? expense.activityId : prefill?.activityId ?? null);
  const [payerIds, setPayerIds] = useState<string[]>(() =>
    expense
      ? peopleIds.filter((id) => expense.payers.some((payer) => payer.userId === id))
      : [members.some((m) => m.userId === currentUserId) ? currentUserId : members[0]?.userId ?? currentUserId],
  );
  // Several payers open in amounts mode when editing, so what each one paid stays as stored.
  const [payerMode, setPayerMode] = useState<PayerMode>(expense && expense.payers.length > 1 ? "exact" : "equal");
  const [payerText, setPayerText] = useState<Record<string, string>>(() =>
    expense && expense.payers.length > 1
      ? Object.fromEntries(expense.payers.map((payer) => [payer.userId, centsToText(payer.paidCents, expense.currency, lang)]))
      : {},
  );
  const [method, setMethod] = useState<SplitMethod>(expense?.splitMethod ?? "equal");
  const [participantIds, setParticipantIds] = useState<string[]>(() =>
    expense ? peopleIds.filter((id) => expense.splits.some((split) => split.userId === id)) : members.map((member) => member.userId),
  );
  const [exactText, setExactText] = useState<Record<string, string>>(() =>
    expense?.splitMethod === "exact" ? Object.fromEntries(expense.splits.map((split) => [split.userId, centsToText(split.shareCents, expense.currency, lang)])) : {},
  );
  const [percentText, setPercentText] = useState<Record<string, string>>(() =>
    expense?.splitMethod === "percent"
      ? Object.fromEntries(expense.splits.map((split) => [split.userId, String((split.percentBp ?? 0) / 100).replace(".", lang === "es" ? "," : ".")]))
      : {},
  );
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [receiptPath, setReceiptPath] = useState<string | null>(expense?.receiptPath ?? null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptRemoved, setReceiptRemoved] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = !canEdit || busy;

  // Preview: the picked file (object URL), else the stored receipt (signed URL).
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (receiptFile && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      objectUrl = URL.createObjectURL(receiptFile);
      setPreviewUrl(objectUrl);
    } else if (receiptPath && !receiptRemoved) {
      void resolveReceiptUrl(receiptPath, client).then((url) => !cancelled && setPreviewUrl(url));
    } else {
      setPreviewUrl(null);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [receiptFile, receiptPath, receiptRemoved, client]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmDialog && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDialog, busy, onClose]);

  const amountCents = parseAmountToCents(amountText, currency);
  const exactCents = Object.fromEntries(participantIds.map((id) => [id, exactText[id]?.trim() ? parseAmountToCents(exactText[id], currency) ?? Number.NaN : 0]));
  const percentBp = Object.fromEntries(participantIds.map((id) => [id, percentTextToBp(percentText[id] ?? "") ?? Number.NaN]));
  const paidBy = payerIds[0] ?? "";
  const split = amountCents ? computeSplits({ method, amountCents, participantIds, exactCents, percentBp, payerId: paidBy }) : null;
  const payerCents = Object.fromEntries(payerIds.map((id) => [id, payerText[id]?.trim() ? parseAmountToCents(payerText[id], currency) ?? Number.NaN : 0]));
  const paid = amountCents ? computePayers({ amountCents, payerIds, mode: payerIds.length > 1 ? payerMode : "equal", exactCents: payerCents }) : null;
  // Live "left to assign" for typed payer amounts.
  const payersLeft =
    payerIds.length > 1 && payerMode === "exact" && amountCents
      ? amountCents - Object.values(payerCents).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)
      : null;
  const valid = Boolean(title.trim()) && Boolean(amountCents) && Boolean(split?.ok) && Boolean(paid?.ok);

  // Live "left to assign" for typed shares.
  const remaining = (() => {
    if (method === "exact" && amountCents) {
      const sum = Object.values(exactCents).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
      return { left: amountCents - sum, format: (value: number) => formatCents(value, currency, lang) };
    }
    if (method === "percent") {
      const sum = Object.values(percentBp).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
      return { left: 10000 - sum, format: (value: number) => new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 2 }).format(value / 10000) };
    }
    return null;
  })();
  const splitError = split && !split.ok && !(remaining && (split.error === "sum_mismatch" || split.error === "percent_mismatch")) ? t(SPLIT_ERROR_KEYS[split.error]) : null;

  const changeMethod = (next: SplitMethod) => {
    setMethod(next);
    if (next === "individual") setParticipantIds((current) => [current.includes(paidBy) ? paidBy : current[0] ?? paidBy]);
  };
  // Someone always pays: the last payer cannot be removed.
  const togglePayer = (userId: string) => {
    const next = new Set(payerIds);
    if (next.has(userId)) {
      if (next.size === 1) return;
      next.delete(userId);
    } else next.add(userId);
    setPayerIds(peopleIds.filter((id) => next.has(id)));
  };
  const toggleParticipant = (userId: string) => {
    const next = new Set(participantIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setParticipantIds(peopleIds.filter((id) => next.has(id)));
  };

  const showError = (code: ExpenseError | undefined) => setError(t(ERROR_KEYS[code ?? "failed"]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !split?.ok || !paid?.ok || !amountCents || busy || !canEdit) return;
    if (!online) return showError("offline");
    setBusy(true);
    setError(null);
    try {
      const saved = await saveExpense(client, {
        ...(savedId ? { id: savedId } : {}),
        tripId,
        activityId,
        title,
        amountCents,
        currency,
        spentOn,
        category,
        payers: paid.payers,
        splitMethod: method,
        notes,
        splits: split.splits,
      });
      if (saved.error || !saved.id) return showError(saved.error);
      setSavedId(saved.id);
      let receiptFailed = false;
      if (receiptFile) {
        const uploaded = await uploadReceipt(client, { tripId, expenseId: saved.id, file: receiptFile, previousPath: receiptRemoved ? null : receiptPath });
        if (uploaded.path) {
          setReceiptPath(uploaded.path);
          setReceiptFile(null);
          setReceiptRemoved(false);
        } else receiptFailed = true;
      } else if (receiptRemoved && receiptPath) {
        const removed = await removeReceipt(client, { expenseId: saved.id, path: receiptPath });
        if (removed.error) receiptFailed = true;
        else {
          setReceiptPath(null);
          setReceiptRemoved(false);
        }
      }
      onSaved();
      if (receiptFailed) setError(t("expenses_receipt_failed"));
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!savedId || busy) return;
    if (!(await confirm({ message: t("expenses_delete_confirm") }))) return;
    setBusy(true);
    const { error: deleteError } = await deleteExpense(client, { id: savedId, receiptPath });
    setBusy(false);
    if (deleteError) return showError(deleteError);
    onSaved();
    onClose();
  };

  const showReceipt = Boolean(receiptFile) || (Boolean(receiptPath) && !receiptRemoved);
  const heading = !canEdit ? "expenses_editor_view" : expense ? "expenses_editor_edit" : "expenses_editor_new";

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center md:items-center md:p-4">
      {confirmDialog}
      <div className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm" aria-hidden="true" onClick={() => !busy && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-[var(--color-surface)] shadow-xl md:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
          <h2 id={titleId} className="text-base font-black text-[var(--color-text)]">{t(heading)}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("expenses_editor_close")}
            className="inline-flex size-11 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 space-y-5 overflow-y-auto px-5 py-4" aria-busy={busy}>
          {!canEdit && (
            <p className="rounded-xl bg-[var(--color-surface-subtle)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]">{t("expenses_read_only")}</p>
          )}

          <div className="space-y-2">
            <label htmlFor={ids.title} className={fieldLabel}>{t("expenses_field_title")}</label>
            <input
              id={ids.title}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              disabled={disabled}
              placeholder={t("expenses_field_title_placeholder")}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-2">
              <label htmlFor={ids.amount} className={fieldLabel}>{t("expenses_field_amount")}</label>
              <input
                id={ids.amount}
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                disabled={disabled}
                placeholder="0,00"
                aria-invalid={amountText.trim() !== "" && !amountCents}
                className={`${inputClass} text-lg font-bold tabular-nums`}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={ids.currency} className={fieldLabel}>{t("expenses_field_currency")}</label>
              <select id={ids.currency} value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={disabled} className={`${inputClass} w-28`}>
                {currencyChoices(currency).map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor={ids.date} className={fieldLabel}>{t("expenses_field_date")}</label>
            <input id={ids.date} type="date" value={spentOn} onChange={(event) => event.target.value && setSpentOn(event.target.value)} disabled={disabled} className={inputClass} />
          </div>

          {(activityGroups.length > 0 || activityId) && (
            <div className="space-y-2">
              <label htmlFor={ids.activity} className={fieldLabel}>{t("expenses_field_activity")}</label>
              <select id={ids.activity} value={activityId ?? ""} onChange={(event) => setActivityId(event.target.value || null)} disabled={disabled} className={inputClass}>
                <option value="">{t("expenses_activity_none")}</option>
                {activityId && !activityGroups.some((group) => group.options.some((option) => option.id === activityId)) && (
                  <option value={activityId}>{t("expenses_activity_missing")}</option>
                )}
                {activityGroups.map((group) => (
                  <optgroup key={group.dayId} label={group.date ? formatDay(group.date, lang) : group.label}>
                    {group.options.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className={fieldLabel}>{t("expenses_field_category")}</legend>
            <div className="flex flex-wrap gap-2">
              {EXPENSE_CATEGORIES.map((value) => {
                const Icon = CATEGORY_ICONS[value];
                return (
                  <label key={value} className={chipClass(category === value)}>
                    <input type="radio" name={`${titleId}-category`} value={value} checked={category === value} onChange={() => setCategory(value)} disabled={disabled} className="sr-only" />
                    <Icon size={14} aria-hidden="true" />
                    {t(CATEGORY_KEYS[value])}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-2" aria-describedby={payersLeft !== null ? `${titleId}-payers-status` : undefined}>
            <legend className={fieldLabel}>{t("expenses_field_payer")}</legend>
            <div className="flex flex-wrap gap-2">
              {peopleIds.map((userId) => {
                const selected = payerIds.includes(userId);
                // A former member can stay as a payer but never be added as one.
                const locked = !people.isMember(userId) && !selected;
                return (
                  <label key={userId} className={chipClass(selected)}>
                    <input
                      type="checkbox"
                      name={`${titleId}-payer`}
                      value={userId}
                      checked={selected}
                      onChange={() => togglePayer(userId)}
                      disabled={disabled || locked}
                      className="sr-only"
                    />
                    <MemberAvatar member={people.member(userId)} size="xs" />
                    {people.name(userId)}
                  </label>
                );
              })}
            </div>
            {payerIds.length > 1 && (
              <div className="space-y-2 rounded-2xl border border-[var(--color-border)] p-3">
                <div role="radiogroup" aria-label={t("expenses_payers_mode")} className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--color-surface-subtle)] p-1">
                  {(["equal", "exact"] as const).map((value) => (
                    <label
                      key={value}
                      className={`min-h-11 inline-flex cursor-pointer items-center justify-center rounded-lg px-2 text-xs font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)] ${
                        payerMode === value ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"
                      }`}
                    >
                      <input type="radio" name={`${titleId}-payer-mode`} value={value} checked={payerMode === value} onChange={() => setPayerMode(value)} disabled={disabled} className="sr-only" />
                      {t(value === "equal" ? "expenses_payers_equal" : "expenses_payers_exact")}
                    </label>
                  ))}
                </div>
                <ul className="space-y-1">
                  {payerIds.map((userId) => {
                    const name = people.name(userId);
                    return (
                      <li key={userId} className="flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                        <MemberAvatar member={people.member(userId)} size="sm" />
                        <span className="flex-1">{name}</span>
                        {payerMode === "exact" ? (
                          <input
                            value={payerText[userId] ?? ""}
                            onChange={(event) => setPayerText((current) => ({ ...current, [userId]: event.target.value }))}
                            inputMode="decimal"
                            disabled={disabled}
                            aria-label={t("expenses_paid_amount_of", { name })}
                            placeholder="0,00"
                            className={`${inputClass} w-28 text-right tabular-nums`}
                          />
                        ) : (
                          paid?.ok && (
                            <span className="text-xs font-semibold tabular-nums text-[var(--color-text-secondary)]">
                              {formatCents(paid.payers.find((entry) => entry.userId === userId)?.paidCents ?? 0, currency, lang)}
                            </span>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
                {payersLeft !== null && (
                  <p
                    id={`${titleId}-payers-status`}
                    role="status"
                    className={`text-xs font-bold ${payersLeft === 0 ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"}`}
                  >
                    {payersLeft === 0
                      ? t("expenses_remaining_ok")
                      : t(payersLeft > 0 ? "expenses_remaining_missing" : "expenses_remaining_over", { amount: formatCents(Math.abs(payersLeft), currency, lang) })}
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className={fieldLabel}>{t("expenses_field_method")}</legend>
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-1 sm:grid-cols-4">
              {METHODS.map((value) => (
                <label
                  key={value}
                  className={`min-h-11 inline-flex cursor-pointer items-center justify-center rounded-xl px-2 text-xs font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)] ${
                    method === value ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  <input type="radio" name={`${titleId}-method`} value={value} checked={method === value} onChange={() => changeMethod(value)} disabled={disabled} className="sr-only" />
                  {t(METHOD_KEYS[value])}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2" aria-describedby={remaining || splitError ? `${titleId}-split-status` : undefined}>
            <legend className={fieldLabel}>{t("expenses_field_people")}</legend>
            <ul className="space-y-1">
              {peopleIds.map((userId) => {
                const included = participantIds.includes(userId);
                const name = people.name(userId);
                // A former member can stay on an expense but never be added to one.
                const locked = !people.isMember(userId) && !included;
                return (
                  <li key={userId} className="flex min-h-11 items-center gap-2">
                    <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                      <input
                        type={method === "individual" ? "radio" : "checkbox"}
                        name={`${titleId}-people`}
                        checked={included}
                        onChange={() => (method === "individual" ? setParticipantIds([userId]) : toggleParticipant(userId))}
                        disabled={disabled || locked}
                        className="size-5 accent-[var(--color-primary)]"
                      />
                      <MemberAvatar member={people.member(userId)} size="sm" />
                      {name}
                    </label>
                    {included && method === "exact" && (
                      <input
                        value={exactText[userId] ?? ""}
                        onChange={(event) => setExactText((current) => ({ ...current, [userId]: event.target.value }))}
                        inputMode="decimal"
                        disabled={disabled}
                        aria-label={t("expenses_share_amount_of", { name })}
                        placeholder="0,00"
                        className={`${inputClass} w-28 text-right tabular-nums`}
                      />
                    )}
                    {included && method === "percent" && (
                      <span className="inline-flex items-center gap-1">
                        <input
                          value={percentText[userId] ?? ""}
                          onChange={(event) => setPercentText((current) => ({ ...current, [userId]: event.target.value }))}
                          inputMode="decimal"
                          disabled={disabled}
                          aria-label={t("expenses_share_percent_of", { name })}
                          placeholder="0"
                          className={`${inputClass} w-20 text-right tabular-nums`}
                        />
                        <span className="text-xs font-bold text-[var(--color-text-muted)]" aria-hidden="true">%</span>
                      </span>
                    )}
                    {included && method === "equal" && split?.ok && (
                      <span className="text-xs font-semibold tabular-nums text-[var(--color-text-secondary)]">
                        {formatCents(split.splits.find((entry) => entry.userId === userId)?.shareCents ?? 0, currency, lang)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {(remaining || splitError) && (
              <p
                id={`${titleId}-split-status`}
                role="status"
                className={`text-xs font-bold ${remaining && remaining.left === 0 && !splitError ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"}`}
              >
                {splitError ??
                  (remaining!.left === 0
                    ? t("expenses_remaining_ok")
                    : t(remaining!.left > 0 ? "expenses_remaining_missing" : "expenses_remaining_over", { amount: remaining!.format(Math.abs(remaining!.left)) }))}
              </p>
            )}
          </fieldset>

          <div className="space-y-2">
            <label htmlFor={ids.notes} className={fieldLabel}>{t("expenses_field_notes")}</label>
            <textarea
              id={ids.notes}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={2}
              disabled={disabled}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-70"
            />
          </div>

          <div className="space-y-2">
            <span className={fieldLabel}>{t("expenses_field_receipt")}</span>
            {showReceipt && previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- object or signed URLs of a private bucket
              <img src={previewUrl} alt={t("expenses_receipt_alt")} className="max-h-56 w-full rounded-xl border border-[var(--color-border)] object-contain bg-[var(--color-surface-subtle)]" />
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={chipClass(false)}>
                  <ImagePlus size={16} aria-hidden="true" />
                  {t(showReceipt ? "expenses_receipt_replace" : "expenses_receipt_add")}
                </button>
                {showReceipt && (
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptFile(null);
                      setReceiptRemoved(Boolean(receiptPath));
                    }}
                    disabled={busy}
                    className={chipClass(false)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    {t("expenses_receipt_remove")}
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={RECEIPT_ACCEPT}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) setReceiptFile(file);
                    event.target.value = "";
                  }}
                />
              </div>
            )}
            {!canEdit && !showReceipt && <p className="text-xs text-[var(--color-text-muted)]">{t("expenses_receipt_none")}</p>}
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-[var(--color-danger)]/10 px-3 py-2 text-xs font-bold text-[var(--color-danger)]">{error}</p>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
              {savedId ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy || !online}
                  className="min-h-11 inline-flex items-center gap-2 rounded-xl px-3 text-xs font-bold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {t("expenses_delete")}
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={!valid || busy || !online}
                className="min-h-11 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-black text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:pointer-events-none"
              >
                {busy ? t("expenses_saving") : t("expenses_save")}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>,
    document.body,
  );
}
