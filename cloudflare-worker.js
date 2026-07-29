import { handleAsNodeRequest } from "cloudflare:node";
import serverModule from "./server.js";

export default {
  fetch(request) {
    return handleAsNodeRequest(3000, request);
  },

  scheduled(_controller, _env, ctx) {
    ctx.waitUntil(serverModule.runScheduledMaintenance());
  }
};
