import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

test("configured agent strips checkout credentials from transaction and span payloads without a collector", () => {
  const output = execFileSync(process.execPath, ["-e", `
    const Config = require('newrelic/lib/config');
    const Agent = require('newrelic/lib/agent');
    const Transaction = require('newrelic/lib/transaction');
    const { Attributes } = require('newrelic/lib/attributes');
    const config = Config.initialize();
    config.simple_compression = true;
    const agent = new Agent(config);
    const uuid = '00000000-0000-4000-8000-000000000099';
    const results = [];
    for (const path of ['/checkout/company/' + uuid, '/api/orders/' + uuid + '/checkout-link', '/es-PE/orders/' + uuid]) {
      const transaction = new Transaction(agent);
      transaction.url = path;
      for (const key of ['request.uri', 'request.parameters.orderId', 'request.headers.referer', 'http.url', 'orderId']) {
        transaction.trace.attributes.addAttribute(Attributes.DESTINATIONS.TRANS_SCOPE, key, path);
        transaction.trace.root.addSpanAttribute(key, path);
      }
      transaction.finalizeNameFromWeb(200);
      results.push({ name: transaction.getFullName(), payload: transaction.trace.generateJSONSync(),
        attributes: transaction.trace.attributes.get(Attributes.DESTINATIONS.TRANS_SCOPE),
        spanAttributes: transaction.trace.root.attributes.get(Attributes.DESTINATIONS.SPAN_EVENT) });
    }
    process.stdout.write(JSON.stringify({ stripMessages: config.strip_exception_messages.enabled, results }));
  `], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NEW_RELIC_NO_CONFIG_FILE: "false", NEW_RELIC_LOG: "/dev/null" } });
  expect(output).not.toContain("00000000-0000-4000-8000-000000000099");
  const result = JSON.parse(output);
  expect(result.stripMessages).toBe(true);
  expect(result.results.map((entry: { name: string }) => entry.name)).toEqual([
    "WebTransaction/NormalizedUri/checkout", "WebTransaction/NormalizedUri/orders/checkout-link", "WebTransaction/NormalizedUri/orders/detail",
  ]);
  for (const entry of result.results) {
    expect(entry.payload[3]).toBeNull();
    expect(entry.attributes).not.toHaveProperty("request.uri");
    expect(entry.spanAttributes).not.toHaveProperty("orderId");
  }
});
