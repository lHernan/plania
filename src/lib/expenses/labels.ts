type Translate = (key: string, variables?: Record<string, string | number>) => string;

/** "Pagó Ana", "Pagaron Ana y Jack", "Pagaron Ana y 2 más". */
export function payersLabel(payerIds: string[], people: { name: (userId: string) => string }, t: Translate): string {
  const [first, second] = payerIds.map((id) => people.name(id));
  if (payerIds.length <= 1) return t("expenses_paid_by", { name: first ?? people.name("") });
  if (payerIds.length === 2) return t("expenses_paid_by_two", { first, second });
  return t("expenses_paid_by_many", { first, count: payerIds.length - 1 });
}
