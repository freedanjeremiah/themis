/** Consistent page title + one-line "what this is" explainer + section rule. */
export function PageHead({ title, intro }: { title: string; intro: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="pretty mt-1 max-w-[60ch] font-serif text-base italic text-ink-2">{intro}</p>
      <div className="mt-2.5 border-b-2 border-ink" />
    </header>
  );
}
