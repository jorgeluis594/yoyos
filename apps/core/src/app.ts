import express from "express";

export const app = express();

app.use("/api", express.json(), (_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use("/webhooks", express.raw({ type: "*/*" }), (_request, response) => {
  response.sendStatus(404);
});
