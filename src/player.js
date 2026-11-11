(function (root) {
  function avcCodec(data) {
    for (let i = 0; i + 7 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
        const h = (x) => x.toString(16).padStart(2, "0");
        return "avc1." + h(data[i + 4]) + h(data[i + 5]) + h(data[i + 6]);
      }
    }
    return "avc1.640033";
  }
  function Player(canvas, onFps, onErr) {
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    let dec = null, name = "", pending = null, needKey = true, count = 0, view = { rot: 0, mirror: false }, w = 0, h = 0;
    const tick = setInterval(() => { onFps && onFps(count); count = 0; }, 1000);
    function reset() {
      if (dec && dec.state !== "closed") dec.close();
      dec = null;
      needKey = true;
    }
    function draw(frame) {
      const fw = frame.displayWidth, fh = frame.displayHeight, side = view.rot % 180 !== 0;
      const cw = side ? fh : fw, ch = side ? fw : fh;
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate((view.rot * Math.PI) / 180);
      if (view.mirror) ctx.scale(-1, 1);
      ctx.drawImage(frame, -fw / 2, -fh / 2, fw, fh);
      frame.close();
      count++;
    }
    function make(config) {
      reset();
      const codec = name === "h265" ? "hev1.1.6.L153.B0" : name === "av1" ? "av01.0.08M.08" : avcCodec(config);
      dec = new VideoDecoder({ output: draw, error: (e) => { console.error(e); reset(); onErr && onErr(e); } });
      dec.configure({ codec, optimizeForLatency: true, hardwareAcceleration: "no-preference" });
    }
    function feed(ev) {
      if (ev.t === "codec") { name = ev.name; reset(); return; }
      if (ev.t === "size") { w = ev.w; h = ev.h; return; }
      if (ev.t !== "pkt") return;
      const data = new Uint8Array(ev.data);
      if (ev.config) { pending = data; make(data); return; }
      if (!dec) return;
      if (needKey && !ev.key) return;
      let buf = data;
      if (ev.key && pending) {
        buf = new Uint8Array(pending.length + data.length);
        buf.set(pending);
        buf.set(data, pending.length);
      }
      needKey = false;
      try { dec.decode(new EncodedVideoChunk({ type: ev.key ? "key" : "delta", timestamp: ev.pts, data: buf })); } catch (e) { reset(); onErr && onErr(e); }
    }
    return {
      feed,
      setView(v) { view = { rot: +v.rot || 0, mirror: !!v.mirror }; },
      clear() { reset(); pending = null; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); },
      size: () => [w, h],
      destroy() { clearInterval(tick); reset(); }
    };
  }
  root.Player = Player;
})(this);
