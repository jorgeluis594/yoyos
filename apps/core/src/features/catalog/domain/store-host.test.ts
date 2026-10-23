import { expect, test } from "vitest";
import { classifyHost, type HostConfig } from "@core/src/features/catalog/domain/store-host";

const config: HostConfig = { baseHostname: "yoyos.lat", appHostname: "app.yoyos.lat" };

test("classifies fantasio.yoyos.lat as a store host with subdomain fantasio", () => {
  expect(classifyHost("fantasio.yoyos.lat", config)).toEqual({ kind: "store", subdomain: "fantasio" });
});

test("classifies a reserved but well-formed label like tienda or pay as a store host, not invalid", () => {
  expect(classifyHost("tienda.yoyos.lat", config)).toEqual({ kind: "store", subdomain: "tienda" });
  expect(classifyHost("pay.yoyos.lat", config)).toEqual({ kind: "store", subdomain: "pay" });
});

test("classifies the app hostname, IPs, localhost and the base apex as the app host", () => {
  for (const hostname of ["app.yoyos.lat", "127.0.0.1", "localhost", "[::1]", "yoyos.lat", "example.com", "fantasio.example.com"])
    expect(classifyHost(hostname, config)).toEqual({ kind: "app" });
});

test("classifies the app host first when the app hostname lies under the base", () => {
  expect(classifyHost("yoyos.kogozstaging.lat", { baseHostname: "yoyos.kogozstaging.lat", appHostname: "yoyos.kogozstaging.lat" })).toEqual({ kind: "app" });
  expect(classifyHost("app.yoyos.lat", { baseHostname: "yoyos.lat", appHostname: "app.yoyos.lat" })).toEqual({ kind: "app" });
});

test("classifies a.b.yoyos.lat, a label with a double hyphen and a two character label as invalid", () => {
  for (const hostname of ["a.b.yoyos.lat", "fan--tasio.yoyos.lat", "ab.yoyos.lat", "-fantasio.yoyos.lat", "fantasio-.yoyos.lat", "café.yoyos.lat", ".yoyos.lat", `${"a".repeat(31)}.yoyos.lat`])
    expect(classifyHost(hostname, config)).toEqual({ kind: "invalid" });
});

test("ignores the port and a trailing dot and lowercases the hostname", () => {
  expect(classifyHost("Fantasio.Yoyos.Lat.", config)).toEqual({ kind: "store", subdomain: "fantasio" });
  expect(classifyHost("fantasio.localhost:3000", { baseHostname: "localhost", appHostname: "localhost" })).toEqual({ kind: "store", subdomain: "fantasio" });
});
