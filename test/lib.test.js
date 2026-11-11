const a = require("assert");
const L = require("../src/lib.js");
const d = L.parseDevices("List of devices attached\nabc123 device usb:1-1 product:x model:24073RPD7G device:y transport_id:1\n192.168.1.5:5555 device product:x model:24073RPD7G\nadb-XYZ._adb-tls-connect._tcp unauthorized\n");
a.strictEqual(d.length, 3);
a.strictEqual(d[0].wifi, false);
a.strictEqual(d[1].wifi, true);
a.strictEqual(d[2].wifi, true);
a.strictEqual(d[2].state, "unauthorized");
a.strictEqual(d[0].model, "24073RPD7G");
const cams = L.parseCams(`[server] INFO: List of cameras:
    --camera-id=0    (back, 4096x3072, fps={15, 24, 30, 60}, zoom-range=[0.6, 10.0])
        - 3840x2160
        - 1920x1080
      High speed capture (--camera-high-speed):
        - 1920x1080 (fps={120, 240})
    --camera-id=1    (front, 3264x2448, fps={15, 30})
        - 1920x1080
`);
a.strictEqual(cams.length, 2);
a.deepStrictEqual(cams[0].fps, [15, 24, 30, 60]);
a.deepStrictEqual(cams[0].sizes, ["3840x2160", "1920x1080"]);
a.deepStrictEqual(cams[0].high, [{ size: "1920x1080", fps: [120, 240] }]);
a.deepStrictEqual(cams[0].zoom, [0.6, 10]);
a.strictEqual(cams[1].facing, "front");
a.strictEqual(cams[1].zoom, null);
a.strictEqual(L.parseIp("26: wlan0: <UP>\n    inet 192.168.0.42/24 brd 192.168.0.255 scope global wlan0"), "192.168.0.42");
a.deepStrictEqual(L.parseMdns("List of discovered mdns services\nadb-ABC-xyz\t_adb-tls-connect._tcp\t192.168.0.42:37011\n"), [{ name: "adb-ABC-xyz", kind: "connect", addr: "192.168.0.42:37011" }]);
const args = L.buildArgs({ serial: "abc", cam: "0", fps: 60, bitrate: 24, codec: "h264", size: "1920x1080", mirror: true, rotate: 90, zoom: 1, mic: false });
a.ok(args.includes("--camera-fps=60") && args.includes("--orientation=flip90") && args.includes("--no-audio") && !args.some((x) => x.startsWith("--camera-zoom")));
a.strictEqual(L.parseFps("INFO: 59 fps"), 59);
a.strictEqual(L.parseFps("INFO: Renderer: direct3d"), null);
console.log("lib ok");
