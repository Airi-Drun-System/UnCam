(function (root) {
  function parseDevices(out) {
    const list = [];
    for (const line of String(out).split(/\r?\n/)) {
      const m = line.match(/^(\S+)\s+(device|unauthorized|offline)\b(.*)$/);
      if (!m) continue;
      const model = (m[3].match(/model:(\S+)/) || [])[1] || "";
      const wifi = /:\d+$/.test(m[1]) || m[1].includes("._adb-tls-connect.");
      list.push({ serial: m[1], state: m[2], model: model.replace(/_/g, " "), wifi });
    }
    return list;
  }
  function parseCams(out) {
    const cams = [];
    let cur = null, high = false;
    for (const line of String(out).split(/\r?\n/)) {
      const c = line.match(/--camera-id=(\S+)\s+\((\w+), (\d+)x(\d+)(?:, fps=[\[{]([^\]}]*)[\]}])?(?:, zoom-range=\[([\d.]+), ([\d.]+)\])?/);
      if (c) {
        cur = { id: c[1], facing: c[2], sensor: c[3] + "x" + c[4], fps: (c[5] || "30").split(",").map((x) => +x.trim()).filter(Boolean), zoom: c[6] ? [+c[6], +c[7]] : null, sizes: [], high: [] };
        cams.push(cur);
        high = false;
        continue;
      }
      if (!cur) continue;
      if (/High speed capture/.test(line)) { high = true; continue; }
      const s = line.match(/^\s*(?:\[server\]\s*\w+:\s*)?-\s+(\d+)x(\d+)(?:\s+\(fps=[\[{]([^\]}]*)[\]}]\))?/);
      if (!s) continue;
      if (high) cur.high.push({ size: s[1] + "x" + s[2], fps: (s[3] || "").split(",").map((x) => +x.trim()).filter(Boolean) });
      else cur.sizes.push(s[1] + "x" + s[2]);
    }
    return cams;
  }
  function parseIp(out) {
    const m = String(out).match(/inet (\d+\.\d+\.\d+\.\d+)/);
    return m ? m[1] : "";
  }
  function parseMdns(out) {
    const r = [];
    for (const line of String(out).split(/\r?\n/)) {
      const m = line.match(/^(\S+)\s+_adb-tls-(connect|pairing)\._tcp\.?\s+(\d+\.\d+\.\d+\.\d+:\d+)/);
      if (m) r.push({ name: m[1], kind: m[2], addr: m[3] });
    }
    return r;
  }
  function buildArgs(o) {
    const a = ["-s", o.serial, "--video-source=camera", "--camera-id=" + o.cam, "--camera-fps=" + o.fps, "--video-bit-rate=" + o.bitrate + "M", "--video-codec=" + o.codec, "--window-title=UnCam", "--print-fps"];
    if (o.size) a.push("--camera-size=" + o.size);
    if (o.high) a.push("--camera-high-speed");
    const rot = String(o.rotate || 0);
    if (o.mirror || rot !== "0") a.push("--orientation=" + (o.mirror ? "flip" : "") + rot);
    if (o.zoom && Math.abs(o.zoom - 1) > 0.01) a.push("--camera-zoom=" + o.zoom);
    if (o.torch) a.push("--camera-torch");
    if (o.mic) a.push("--audio-source=mic");
    else a.push("--no-audio");
    if (o.top) a.push("--always-on-top");
    if (o.borderless) a.push("--window-borderless");
    return a;
  }
  function parseFps(line) {
    const m = String(line).match(/(\d+) fps/);
    return m ? +m[1] : null;
  }
  const api = { parseDevices, parseCams, parseIp, parseMdns, buildArgs, parseFps };
  if (typeof module !== "undefined") module.exports = api;
  else root.UC = api;
})(this);
