"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "@/store/use-auth-store";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/components/I18nProvider";
import { X, Mail, Lock, Loader2, ArrowRight, KeyRound } from "lucide-react";

export function AuthModal({ isOpen, onClose, onShowToast }: { isOpen: boolean; onClose: () => void; onShowToast: (msg: string) => void }) {
  const { t } = useI18n();
  const [isLogin, setIsLogin] = useState(true);
  const [isReset, setIsReset] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signIn, signUp, resetPassword, loading } = useAuthStore();

  const syncFromForm = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const e = (fd.get("email") as string) || email;
    const p = (fd.get("password") as string) || password;
    if (e) setEmail(e);
    if (p) setPassword(p);
    return { email: e, password: p };
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const { email: finalEmail, password: finalPassword } = syncFromForm(form);

    if (isReset) {
      const { error } = await resetPassword(finalEmail);
      if (error) {
        onShowToast(error.message);
        return;
      }
      onShowToast(t("auth_reset_sent"));
      setIsReset(false);
      return;
    }

    // Capture current anonymous user ID BEFORE signing in
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const anonId = currentUser?.is_anonymous ? currentUser.id : null;

    const { error } = isLogin
      ? await signIn(finalEmail, finalPassword)
      : await signUp(finalEmail, finalPassword);

    if (error) {
      onShowToast(error.message);
      return;
    }

    // Transfer anonymous data to the newly authenticated account
    if (anonId && isLogin) {
      const { data: { user: newUser } } = await supabase.auth.getUser();
      if (newUser && newUser.id !== anonId) {
        console.log("Plania: Transferring data from", anonId, "to", newUser.id);
        const { error: rpcError } = await supabase.rpc("transfer_anonymous_data", {
          p_anon_id: anonId,
          p_new_id: newUser.id,
        });
        if (rpcError) console.warn("transfer_anonymous_data RPC error:", rpcError.message);
      }
    }

    onShowToast(isLogin ? t("auth_welcome_back") : t("auth_account_created"));
    onClose();
  };

  if (!isOpen) return null;

  const title = isReset
    ? t("auth_reset_title")
    : isLogin
    ? t("auth_welcome_back_title")
    : t("auth_create_account_title");

  const subtitle = isReset
    ? t("auth_reset_subtitle")
    : isLogin
    ? t("auth_login_subtitle")
    : t("auth_signup_subtitle");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone-950/60 backdrop-blur-md"
      />

      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="relative w-full max-w-md bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-white/20 overflow-hidden"
      >
        <div className="p-8 md:p-10">
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-2 rounded-full hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
            aria-label={t("cancel")}
          >
            <X size={20} className="text-stone-400" />
          </button>

          <div className="mb-8">
            <h2 className="text-3xl font-black text-stone-900 dark:text-white mb-2 font-[family-name:var(--font-display)]">{title}</h2>
            <p className="text-sm font-bold text-stone-400 uppercase tracking-widest">{subtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 ml-1">{t("email")}</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                  className="w-full bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 rounded-2xl py-4 pl-12 pr-4 text-base font-bold focus:ring-2 focus:ring-emerald-800 outline-none transition-all min-h-[48px]"
                  placeholder="name@example.com"
                  autoComplete="username"
                  inputMode="email"
                />
              </div>
            </div>

            {!isReset && (
              <div className="space-y-1">
                <label htmlFor="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 ml-1">{t("password")}</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required={!isReset}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                    className="w-full bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 rounded-2xl py-4 pl-12 pr-4 text-base font-bold focus:ring-2 focus:ring-emerald-800 outline-none transition-all min-h-[48px]"
                    placeholder="••••••••"
                    autoComplete={isLogin ? "current-password" : "new-password"}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-stone-900 dark:bg-white text-white dark:text-stone-900 rounded-2xl py-4 font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 mt-6 min-h-[48px]"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : (
                <>
                  {isReset ? t("auth_send_reset") : isLogin ? t("auth_login") : t("auth_sign_up")}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {isLogin && !isReset && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setIsReset(true)}
                className="text-xs font-bold text-stone-500 hover:text-emerald-800 transition-colors inline-flex items-center gap-1"
              >
                <KeyRound size={12} /> {t("auth_forgot_password")}
              </button>
            </div>
          )}

          {isReset && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setIsReset(false)}
                className="text-xs font-bold text-stone-500 hover:text-emerald-800 transition-colors"
              >
                {t("auth_back_to_login")}
              </button>
            </div>
          )}

          {!isReset && (
            <div className="mt-6 text-center">
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="text-xs font-bold text-stone-500 hover:text-emerald-800 transition-colors"
              >
                {isLogin ? t("auth_no_account") : t("auth_have_account")}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
