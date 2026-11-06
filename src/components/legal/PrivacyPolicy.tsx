import type { ReactNode } from "react";
import Link from "next/link";
import {
  AEPD_URL,
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_POLICY,
  type PolicyBlock,
  type PrivacyPolicyText,
} from "@/lib/legal/privacy-policy";

const linkClass = "font-bold text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)]";

/** Replaces the {email} and {aepd} tokens of a policy string with their links. */
function withLinks(text: string): ReactNode[] {
  return text.split(/(\{email\}|\{aepd\})/).map((part, index) => {
    if (part === "{email}") {
      return (
        <a key={index} href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className={linkClass}>
          {PRIVACY_CONTACT_EMAIL}
        </a>
      );
    }
    if (part === "{aepd}") {
      return (
        <a key={index} href={AEPD_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
          aepd.es
        </a>
      );
    }
    return part;
  });
}

function Block({ block }: { block: PolicyBlock }) {
  if ("list" in block) {
    return (
      <ul className="list-disc space-y-2 pl-5">
        {block.list.map((item) => (
          <li key={item}>{withLinks(item)}</li>
        ))}
      </ul>
    );
  }
  return <p>{withLinks(block.p)}</p>;
}

function PolicyVersion({ text }: { text: PrivacyPolicyText }) {
  const headingId = `privacy-title-${text.lang}`;
  return (
    <section id={text.lang} lang={text.lang} aria-labelledby={headingId} className="scroll-mt-6 space-y-8">
      <header className="space-y-2">
        <h1 id={headingId} className="text-3xl md:text-4xl text-[var(--color-text)] font-[family-name:var(--font-display)]">
          {text.title}
        </h1>
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">{text.lastUpdated}</p>
      </header>
      <p>{text.intro}</p>
      {text.sections.map((section) => (
        <section key={section.id} id={`${text.lang}-${section.id}`} className="space-y-3">
          <h2 className="text-xl text-[var(--color-text)] font-[family-name:var(--font-display)]">{section.title}</h2>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </section>
  );
}

/**
 * The privacy policy in both languages on one server-rendered page: Spanish first, English
 * below, with anchors at the top. The app's language lives only in the browser, so the server
 * cannot pick one, and Google's consent screen links here without any app state.
 */
export function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-2xl space-y-10 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm leading-relaxed text-[var(--color-text-secondary)] md:p-10 md:text-base">
        <nav aria-label="Idioma / Language" className="flex items-center justify-between gap-4 text-xs font-bold">
          <Link href="/" className="uppercase tracking-[0.3em] text-[var(--color-primary)]">
            Tachao
          </Link>
          <span className="flex gap-3">
            <a href="#es" hrefLang="es" className={linkClass}>Español</a>
            <a href="#en" hrefLang="en" className={linkClass}>English</a>
          </span>
        </nav>
        <PolicyVersion text={PRIVACY_POLICY.es} />
        <hr className="border-[var(--color-border)]" />
        <PolicyVersion text={PRIVACY_POLICY.en} />
      </div>
    </main>
  );
}
