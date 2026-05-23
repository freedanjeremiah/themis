import { startPolling } from "./poller.js";
import { httpServer } from "./server.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const PORT = 3002;
httpServer.listen(PORT, () => console.log(`[indexer] listening on :${PORT}`));
startPolling();
