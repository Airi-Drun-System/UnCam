"use strict";
class StreamParser {
  constructor(emit) {
    this.emit = emit;
    this.buf = Buffer.alloc(0);
    this.stage = "dummy";
  }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (this.stage === "dummy") {
        if (b.length < 1) return;
        this.buf = b.subarray(1);
        this.stage = "codec";
      } else if (this.stage === "codec") {
        if (b.length < 4) return;
        const id = b.readUInt32BE(0);
        this.buf = b.subarray(4);
        this.stage = "pkt";
        this.emit({ t: "codec", id, name: id === 0x68323634 ? "h264" : id === 0x68323635 ? "h265" : id === 0x00617631 ? "av1" : id <= 1 ? "error" : "unknown" });
        if (id <= 1) return;
      } else {
        if (b.length < 12) return;
        if (b[0] & 0x80) {
          this.emit({ t: "size", w: b.readUInt32BE(4), h: b.readUInt32BE(8) });
          this.buf = b.subarray(12);
          continue;
        }
        const size = b.readUInt32BE(8);
        if (b.length < 12 + size) return;
        const hi = b.readUInt32BE(0), lo = b.readUInt32BE(4);
        this.emit({ t: "pkt", config: !!(hi & 0x40000000), key: !!(hi & 0x20000000), pts: (hi & 0x1fffffff) * 4294967296 + lo, data: Buffer.from(b.subarray(12, 12 + size)) });
        this.buf = b.subarray(12 + size);
      }
    }
  }
}
function serverArgs(o) {
  if (o.source === "app" || o.source === "screen") return ["scid=" + o.scid, "log_level=info", "tunnel_forward=true", "audio=false", "control=true", "cleanup=true", "send_device_meta=false", "video_source=display", "max_fps=" + o.fps, "stay_awake=true", "video_bit_rate=" + o.bitrate * 1000000, "video_codec=" + o.codec];
  const a = ["scid=" + o.scid, "log_level=info", "tunnel_forward=true", "audio=false", "control=true", "cleanup=true", "send_device_meta=false", "video_source=camera", "camera_id=" + o.cam, "camera_fps=" + o.fps, "video_bit_rate=" + o.bitrate * 1000000, "video_codec=" + o.codec];
  if (o.size) a.push("camera_size=" + o.size);
  if (o.high) a.push("camera_high_speed=true");
  if (o.zoom && Math.abs(o.zoom - 1) > 0.01) a.push("camera_zoom=" + o.zoom);
  if (o.torch) a.push("camera_torch=true");
  return a;
}
module.exports = { StreamParser, serverArgs };
