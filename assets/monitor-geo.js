// K1 ▸ GEO — auth gate only; content is the /world/ iframe.
import { initTerminal, setConnState } from "./core.js";

initTerminal({ title: "GEO", onAuth: async () => { setConnState("live"); } })
  .catch(e => console.error(e));
