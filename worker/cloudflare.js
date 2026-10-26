// Cloudflare deployment entry (see wrangler.jsonc and docs/cloudflare-hosting.md).
// worker/index.js stays the entry for the original host. Here every request
// passes the Cloudflare Access gate first; the gate alone sets the owner header.
import app from './index.js';
import { withCloudflareAccess } from './cloudflare-access.js';

export default withCloudflareAccess(app);
