/**
 * WA-12 static source checks for the Android receive service. They read the Kotlin and manifest sources;
 * they do not run Android, Gradle, an emulator or WhatsApp. Behavioural coverage lives in the JVM and
 * instrumented tests under android/src/test and android/src/androidTest, which were not executed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "android", "src");
const kotlin = (name: string) => readFileSync(join(root, "main", "java", "expo", "modules", "whatsapp", name), "utf8");
const manifest = readFileSync(join(root, "main", "AndroidManifest.xml"), "utf8");
const module = kotlin("WhatsAppModule.kt");
const service = kotlin("WhatsAppService.kt");
const policy = kotlin("ReceiveServicePolicy.kt");

/** Text of `fun name(...) { ... }` or `AsyncFunction("name") { ... }` up to its balanced closing brace. */
function body(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${marker}`);
  const open = source.indexOf("{", source.indexOf(")", start) >= 0 ? start : start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`unbalanced ${marker}`);
}
const between = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const order = (text: string, first: string, second: string) => {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  return a >= 0 && b >= 0 && a < b;
};
const allMainSources = () =>
  readdirSync(join(root, "main", "java", "expo", "modules", "whatsapp")).map((name) => kotlin(name)).join("\n") + manifest;

describe("IT-AND-01 manifest", () => {
  test("declares the three permissions and one private same-process remoteMessaging service", () => {
    for (const permission of ["INTERNET", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_REMOTE_MESSAGING"]) {
      expect(manifest).toContain(`<uses-permission android:name="android.permission.${permission}" />`);
    }
    const tag = /<service[\s\S]*?\/>/.exec(manifest)?.[0] ?? "";
    expect(tag).toContain('android:name="expo.modules.whatsapp.WhatsAppService"');
    expect(tag).toContain('android:exported="false"');
    expect(tag).toContain('android:stopWithTask="false"');
    expect(tag).toContain('android:foregroundServiceType="remoteMessaging"');
    expect(tag).not.toContain("android:process");
    expect(manifest.match(/<service/g)).toHaveLength(1);
    expect(manifest).not.toMatch(/dataSync|specialUse|mediaPlayback|<intent-filter/);
  });
  test("the class named by the manifest exists", () => {
    expect(service).toContain("class WhatsAppService : Service()");
    expect(policy).toContain('SERVICE_CLASS = "expo.modules.whatsapp.WhatsAppService"');
  });
});

describe("IT-AND-02 promotion before heavy work", () => {
  test("promotes before restoring and restores off the main thread", () => {
    const start = body(service, "override fun onStartCommand");
    expect(order(start, "promote()", "restoreFromService")).toBe(true);
    expect(start).toContain("worker.execute");
    expect(body(service, "override fun onCreate")).toContain("promote()");
  });
  test("connect starts the service before opening Go or storage", () => {
    const connect = body(module, 'AsyncFunction("connect")');
    expect(order(connect, "ConnectionRuntime.startService", "writer.open()")).toBe(true);
    expect(order(connect, "ConnectionRuntime.startService", "ConnectionRuntime.openConnection")).toBe(true);
  });
  test("the typed foreground constant is guarded to API 34 and used nowhere else", () => {
    expect(policy).toMatch(/FIRST_TYPED_API = 34/);
    expect(policy).toMatch(/if \(sdk >= FIRST_TYPED_API\) ServiceInfo\.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else null/);
    expect(service).not.toContain("FOREGROUND_SERVICE_TYPE");
    expect(service).toMatch(/if \(type != null\) startForeground\([^)]*type\)\s*\n\s*else startForeground\(/);
  });
});

describe("IT-AND-03 generic notification", () => {
  test("stable low-importance channel, reserved id, immutable explicit intent, no actions", () => {
    expect(policy).toContain('CHANNEL_ID = "whatsapp-connection"');
    expect(policy).toMatch(/NOTIFICATION_ID = \d+/);
    expect(service).toContain("IMPORTANCE_LOW");
    expect(service).toContain("PendingIntent.FLAG_IMMUTABLE");
    expect(service).toContain("setComponent(component)");
    expect(code(service)).not.toMatch(/addAction|setContentText|accountId|qr|session/i);
    // m4/m5: a dedicated monochrome drawable and localizable, overridable texts.
    expect(service).toContain("R.drawable.whatsapp_connection_icon");
    expect(service).not.toContain("applicationInfo.icon");
    expect(code(service)).not.toMatch(/"[^"]*(Conexi|connection)[^"]*"/i);
    const res = join(__dirname, "android", "src", "main", "res");
    expect(readFileSync(join(res, "values", "strings.xml"), "utf8")).toContain("whatsapp_connection_title");
    expect(readFileSync(join(res, "values-es", "strings.xml"), "utf8")).toContain("whatsapp_connection_title");
    expect(readFileSync(join(res, "drawable", "whatsapp_connection_icon.xml"), "utf8")).toContain("<vector");
  });
});

describe("IT-AND-04 notification permission", () => {
  test("nothing requests or checks POST_NOTIFICATIONS and a failed promotion is the only stop", () => {
    expect(allMainSources()).not.toMatch(/POST_NOTIFICATIONS|requestPermissions|areNotificationsEnabled/);
    expect(between(module, "fun startService", "fun stopService")).not.toContain("Permission");
  });
});

describe("IT-AND-05 refused start", () => {
  test("a synchronous refusal is a failed Result before any state change", () => {
    expect(between(module, "fun startService", "/** True from")).toContain('"CONNECTION_FAILED" }');
    const connect = body(module, 'AsyncFunction("connect")');
    expect(connect).toMatch(/startService\(context\)\?\.let \{ return@synchronized failure\(it\) \}/);
    expect(order(connect, "startService(context)", "armIntent")).toBe(true);
  });
  test("a later refusal withdraws the intent, announces error then disconnected, and does not loop", () => {
    const refused = body(module, "fun serviceRefused");
    expect(order(refused, "stopAndRetire()", '"error"')).toBe(true);
    expect(refused).toContain('"disconnected"');
    expect(refused).not.toMatch(/endSession|logout/);
    const promote = body(service, "private fun promote");
    expect(promote).toContain("refused = true");
    expect(promote).toContain("stopSelf()");
    expect(body(service, "override fun onStartCommand")).toContain("START_NOT_STICKY");
    expect(allMainSources()).not.toMatch(/foregroundServiceType="(?!remoteMessaging)/);
  });
});

describe("IT-AND-06 screens do not own the client", () => {
  test("destroying the JavaScript runtime only detaches emit and the consumer", () => {
    expect(body(module, "fun runtimeDestroyed")).not.toMatch(/stop|disconnect|close|withdraw/);
    expect(module).toContain("OnDestroy { synchronized(ConnectionRuntime.lock) { ConnectionRuntime.runtimeDestroyed() } }");
    expect(service).not.toContain("onTaskRemoved");
  });
});

describe("IT-AND-07 and IT-AND-08 restoration", () => {
  const restore = body(module, "fun restoreFromService");
  test("one decision from the stored intent, session and revocation, under one lock hold", () => {
    expect(restore).toContain("ReceiveServicePolicy.decideRestore(store.receiveIntent()");
    expect(module).toMatch(/fun restoreFromService\(context: Context\): Boolean = synchronized\(lock\)/);
    // M1: an already open session is adopted but still connected (Controller.Connect is idempotent).
    expect(restore).not.toContain("if (session != null) return true");
    expect(order(restore, "openConnection(context, snapshot)", "session?.connect()")).toBe(true);
    expect(restore).not.toMatch(/session\s*(!=|==)\s*null\)\s*return true/);
    expect(order(restore, "decideRestore", "openConnection")).toBe(true);
  });
  test("never starts a QR or an old revision in the background", () => {
    expect(restore).not.toMatch(/currentQR|beginFreshProtocolSession|registerFreshGeneration|updateOptions/);
    expect(body(service, "override fun onStartCommand")).toContain("restoreFromService");
    expect(service).toContain("START_STICKY");
  });
  test("a failed restoration withdraws the intent instead of retrying through START_STICKY", () => {
    expect(restore).toMatch(/stopAndRetire\(\); return false/);
    expect(body(service, "override fun onStartCommand")).toMatch(/restoreFromService\(applicationContext\)\) stopSelfResult\(startId\)/);
  });
  test("a revoked session or a local fault withdraws the intent without deleting credentials", () => {
    const observe = body(module, "private fun observeConnectionEvent");
    expect(observe).toContain("retireIntent()");
    expect(observe).toContain("isLocalFault");
    expect(observe).not.toMatch(/endSession|logout|deleteEntry/);
    expect(observe).toContain("background.execute"); // Go's thread never takes the runtime lock inline
  });
});

describe("IT-AND-09 durable withdrawal", () => {
  test("disconnect withdraws before reporting success and reports a failed save", () => {
    const disconnect = body(module, 'AsyncFunction("disconnect")');
    expect(disconnect).toContain("stopAndRetire()?.let { failure(it) } ?: success()");
    const stopAndRetire = body(module, "fun stopAndRetire");
    expect(order(stopAndRetire, "retireIntent()", "stop()")).toBe(true);
    expect(body(module, "fun withdrawIntent")).toContain("intentRetirementPending = true");
  });
  test("logout withdraws before the unlink attempt and keeps credentials when saving fails", () => {
    const logout = body(module, 'AsyncFunction("logout")');
    expect(order(logout, "retireIntent()", "session?.logout()")).toBe(true);
    expect(logout).toMatch(/retireIntent\(\)\?\.let \{ code -> ConnectionRuntime\.stop\(\); return@synchronized failure\(code\) \}/);
  });
  test("a restoration can never resurrect a withdrawn intent", () => {
    const restore = body(module, "fun restoreFromService");
    expect(order(restore, "intentRetirementPending && withdrawIntent()", "store.open()")).toBe(true);
    expect(body(module, "fun withdrawIntent")).toContain("withdrawReceiveIntent()");
  });
});

describe("IT-AND-10 no compensating start", () => {
  test("no boot receiver, alarm, job or work scheduling, and nothing is saved in onDestroy", () => {
    expect(allMainSources()).not.toMatch(/BOOT_COMPLETED|AlarmManager|JobScheduler|WorkManager|RECEIVE_BOOT_COMPLETED|<receiver/);
    expect(code(body(service, "override fun onDestroy"))).not.toMatch(/store|writer|confirm|persist|withdraw/i);
  });
});

describe("IT-AND-12 consumer and pending messages", () => {
  test("restoration neither confirms pending messages nor attaches an Expo consumer", () => {
    const restore = body(module, "fun restoreFromService");
    expect(restore).not.toMatch(/setConsumer|confirm|removeConsumer|emit/);
    expect(restore).toContain("No consumer is attached here");
  });
});

describe("IT-INI-08 and IT-CFG-03 adoption and persisted options", () => {
  test("initialize adopts the existing session and restoration reads options from the container", () => {
    expect(body(module, "fun openConnection")).toContain("if (session != null) return null");
    const restore = body(module, "fun restoreFromService");
    expect(restore).toContain('snapshot.getJSONObject("options")');
    expect(restore).toContain("maxRecoveryBufferBytes");
    expect(restore).toContain("maxImageStorageBytes");
  });
  test("neither the native service nor Go reads .env or bundle variables", () => {
    expect(allMainSources()).not.toMatch(/EXPO_PUBLIC|\.env\b|BuildConfig/);
  });
});

describe("review M2 stopping a service that may not be promoted yet", () => {
  test("no code path calls Context.stopService right after startForegroundService", () => {
    const stop = between(module, "fun stopService", "/** Durably withdraws");
    // Stops go to the service as ACTION_STOP; the direct stopService is only the fallback of a refused send.
    expect(stop).toContain("ReceiveServicePolicy.ACTION_STOP");
    expect(stop).toMatch(/catch \(_: Exception\) \{[\s\S]*context\.stopService/);
    expect(stop).toContain("if (!serviceActive) return");
    expect(code(module).match(/context\.stopService\(/g)).toHaveLength(1);
  });
  test("the service promotes first and then stops itself with the start id", () => {
    const start = code(body(service, "override fun onStartCommand"));
    expect(order(start, "promote()", "ACTION_STOP")).toBe(true);
    expect(order(start, "ACTION_STOP", "stopSelfResult(startId)")).toBe(true);
    expect(policy).toContain("did not then call");
    expect(policy).toContain("bringDownServiceLocked");
  });
  test("a refused promotion cannot loop through a new STOP-started instance", () => {
    expect(order(body(module, "fun serviceRefused"), "serviceActive = false", "stopAndRetire()")).toBe(true);
  });
});

describe("review m2 and N1 ended request", () => {
  const observe = () => body(module, "private fun observeConnectionEvent");
  test("a bare disconnected never withdraws: it is settled with Go's requestActive under the lock", () => {
    expect(policy).toMatch(/event == "connectionChanged" && state == "disconnected" -> EventEffect\.CHECK_REQUEST/);
    expect(policy).toMatch(/event == "connectionChanged" && state == "sessionExpired" -> EventEffect\.END/);
    expect(policy).toContain("fun endsRequest(requestActive: Boolean): Boolean = !requestActive");
    expect(observe()).toContain("session?.requestActive()");
    expect(order(observe(), "synchronized(lock)", "requestActive()")).toBe(true);
    expect(order(observe(), "if (!finished) return@synchronized", "retireIntent()")).toBe(true);
    expect(observe()).toContain("background.execute");
  });
  test("a paused or retried request keeps service and intent; only a missing session counts as ended", () => {
    expect(observe()).toContain("?: false");
  });
  test("a request-ending error is settled the same way (a failed resume after a pause emits no new state)", () => {
    expect(policy).toMatch(/event == "error" && endsRequestWithError\(errorCode\) -> EventEffect\.CHECK_REQUEST/);
    expect(observe()).toContain("effect == ReceiveServicePolicy.EventEffect.NONE");
  });
  // WA-12 s1: informational errors (IDENTITY_UNAVAILABLE after initialize() without connect()) arrive with
  // requestActive=false and must not withdraw the durable intent.
  test("s1: only CONNECTION_FAILED settles the request; the module passes the error code", () => {
    expect(policy).toContain('fun endsRequestWithError(errorCode: String?): Boolean = errorCode == "CONNECTION_FAILED"');
    expect(policy).not.toMatch(/event == "error" -> EventEffect/);
    expect(observe()).toContain('fields["code"] as? String');
  });
  test("Go exposes the request state through the bridge", () => {
    const bridge = readFileSync(join(__dirname, "go", "bridge", "connection.go"), "utf8");
    expect(bridge).toContain("func (s *ConnectionSession) RequestActive() bool");
  });
});

describe("review n1 serviceActive race", () => {
  test("an old instance's destroy cannot clear the flag of a newer start", () => {
    expect(body(service, "override fun onDestroy")).toContain("if (ConnectionRuntime.pendingStarts.get() == 0) ConnectionRuntime.serviceActive = false");
    const start = body(module, "fun startService");
    expect(start).toContain("pendingStarts.incrementAndGet()");
    expect(order(start, "pendingStarts.incrementAndGet()", "serviceActive = true")).toBe(true); // r2
    expect(code(body(service, "override fun onStartCommand"))).toContain("pendingStarts.updateAndGet");
  });
});
