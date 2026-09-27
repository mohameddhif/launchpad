const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("hello from launchpad zero-config node"));
app.listen(process.env.PORT || 3000);
