"use client";
import { PageHead } from "../../components/PageHead";
import { Pipeline } from "../../components/Pipeline";
import { useInView } from "../../hooks/useInView";
import { useActiveSection } from "../../hooks/useActiveSection";

const SECTIONS = [
  {
    id: "agents", n: "01", title: "The agents",
    body: "Three independent programs act as traders. On a fixed cycle, each one gathers its own data, asks an AI model what to do, and files a single proposal: an instrument, a direction, a size, a conviction score, and a written rationale. They do not coordinate. They compete.",
  },
  {
    id: "allocator", n: "02", title: "The allocator",
    body: "An off-chain scorer reads every proposal and decides how much of the pool each agent should get this cycle, favoring stronger conviction and better recent performance. It never invents money; it can only move what the vault holds in reserve.",
  },
  {
    id: "vault", n: "03", title: "The vault",
    body: "A smart contract on Arc holds the pool's USDC. When the allocator funds an agent, the vault transfers that USDC to the agent's wallet to trade. When the trade is done, the vault pulls the original stake back plus or minus the result. The vault is the single source of truth for who holds what.",
  },
  {
    id: "loss-cap", n: "04", title: "The daily loss cap",
    body: "Risk is enforced by the contract, not by trust. If an agent loses more than five percent in a single day, it is sidelined automatically and cannot be funded again until the day resets. No human has to intervene.",
  },
  {
    id: "traces", n: "05", title: "Reasoning traces",
    body: "Every decision's full rationale is pinned to IPFS, and a hash of it is anchored on-chain. That means the reasoning you read on the Desk is the same reasoning the agent committed to at the time, and it cannot be quietly edited afterward.",
  },
  {
    id: "safety", n: "06", title: "Testnet and safety",
    body: "This is a prototype on a test network. The USDC is testnet USDC with no real value, the contracts are unaudited, and deposits are capped at one hundred dollars. Treat it as a demonstration of the mechanism, not a place to put money you care about.",
  },
];

function Part({ s }: { s: (typeof SECTIONS)[number] }) {
  const { ref, inView } = useInView<HTMLElement>({ once: true });
  return (
    <section
      id={s.id}
      ref={ref}
      className={`reveal grid scroll-mt-8 grid-cols-[2.75rem_1fr] gap-x-3 py-7 ${inView ? "is-in" : ""}`}
    >
      <span className="font-serif text-2xl leading-none text-ink-3">{s.n}</span>
      <div>
        <h2 className="font-serif text-xl font-medium text-ink">{s.title}</h2>
        <p className="pretty mt-2 max-w-[62ch] text-base leading-relaxed text-ink-2">{s.body}</p>
      </div>
    </section>
  );
}

export default function HowPage() {
  const active = useActiveSection(SECTIONS.map(s => s.id));

  return (
    <div>
      <PageHead title="How it works" intro="The machinery behind the ledger, in plain terms. Follow a single decision from proposal to settlement." />

      {/* Lifecycle diagram */}
      <figure>
        <Pipeline />
        <figcaption className="mt-4 border-t border-ink/15 pt-2 text-center font-serif text-sm italic text-ink-3">
          The lifecycle of one decision, start to finish.
        </figcaption>
      </figure>

      {/* Long-read: sticky contents index + revealed sections */}
      <div className="mt-8 grid gap-x-10 lg:grid-cols-[12rem_1fr]">
        <aside className="hidden lg:block">
          <nav className="sticky top-6 border-l border-ink/15 pl-4">
            <p className="label mb-2.5">Contents</p>
            <ul className="space-y-2">
              {SECTIONS.map(s => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    data-active={active === s.id}
                    className={`ulink inline-block text-xs leading-snug ${active === s.id ? "text-accent" : "text-ink-3 hover:text-ink"}`}
                  >
                    <span className="tnum">{s.n}</span> · {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="divide-y divide-ink/12">
          {SECTIONS.map(s => <Part key={s.id} s={s} />)}
        </div>
      </div>
    </div>
  );
}
