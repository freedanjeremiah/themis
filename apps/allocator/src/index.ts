import { app } from "./server.js";
import { runCycle } from "./cycle.js";

const PORT = 3001;
const CYCLE_MS = 60_000;
const AGENT_OFFSET_MS = 5_000;

app.listen(PORT, () => console.log(`[allocator] listening on :${PORT}`));

setTimeout(() => {
  runCycle().catch(console.error);
  setInterval(() => runCycle().catch(console.error), CYCLE_MS);
}, AGENT_OFFSET_MS);
