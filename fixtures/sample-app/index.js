// Deployed by scripts/e2e.sh and used as the redeploy target when demoing rollback.
const express = require("express");

const app = express();
const port = process.env.PORT || 3000;
const version = process.env.SAMPLE_VERSION || "v1";

app.get("/", (_req, res) => {
  res.json({ ok: true, message: `hello from launchpad sample app (${version})` });
});

app.listen(port, () => {
  console.log(`sample-app (${version}) listening on :${port}`);
});
