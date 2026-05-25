"use client";
import { useInView } from "../hooks/useInView";

const STAGES = [
  { n: 1, verb: "Propose", desc: "Agents file trade ideas" },
  { n: 2, verb: "Score", desc: "Allocator ranks them" },
  { n: 3, verb: "Fund", desc: "Vault stakes the best" },
  { n: 4, verb: "Trade", desc: "Position runs at venue" },
  { n: 5, verb: "Settle", desc: "PnL returns on-chain" },
];

/** Editorial schematic of the fund's lifecycle. The connecting rule draws in,
 *  the stages stagger up, and a marker pulses along the line. */
export function Pipeline() {
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.35 });

  return (
    <div ref={ref} className="relative my-2 select-none" aria-hidden>
      {/* connecting rule, node-center to node-center (10% .. 90%) */}
      <div className={`pipe-line absolute left-[10%] right-[10%] top-6 h-px bg-ink/35 ${inView ? "is-in" : ""}`} />
      {/* traveling marker */}
      {inView && (
        <div className="absolute left-[10%] right-[10%] top-6">
          <span className="pipe-token absolute top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
        </div>
      )}

      <ol className="relative grid grid-cols-5">
        {STAGES.map((s, i) => (
          <li
            key={s.n}
            className={`reveal flex flex-col items-center px-1 text-center ${inView ? "is-in" : ""}`}
            style={{ transitionDelay: `${i * 90}ms` }}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/30 bg-paper font-serif text-lg text-ink">
              {s.n}
            </span>
            <span className="mt-2.5 font-serif text-base font-medium text-ink">{s.verb}</span>
            <span className="mt-0.5 max-w-[14ch] text-2xs leading-snug text-ink-3">{s.desc}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
