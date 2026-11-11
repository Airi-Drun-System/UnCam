const $ = (id) => document.getElementById(id);
const DEF = { mode: "usb", serial: "", cam: "", size: "", fps: 60, brusb: 30, brwifi: 16, codec: "h264", rot: "0", zoom: 1, mirror: false, torch: false, vcam: true, addr: "" };
let S = DEF;
try { S = { ...DEF, ...JSON.parse(localStorage.getItem("uc") || "{}") }; } catch {}
const save = () => { try { localStorage.setItem("uc", JSON.stringify(S)); } catch {} };
let devs = [], cams = [], camCache = {}, running = false, busy = false, target = 60, torchOn = false, lastReset = 0;
const player = Player($("v"), onFps, () => { if (running && Date.now() - lastReset > 1500) { lastReset = Date.now(); window.uc.ctl("reset"); } });

function toast(t) {
  const el = $("toast");
  el.textContent = t;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3200);
}
function log(l) {
  const p = $("log");
  p.textContent = (p.textContent + l + "\n").slice(-12000);
  p.scrollTop = p.scrollHeight;
}
function seg(box, val, on) {
  for (const b of box.querySelectorAll("button")) {
    b.classList.toggle("on", b.dataset.v === String(val));
    b.onclick = () => { on(b.dataset.v); seg(box, b.dataset.v, on); };
  }
}
async function adb(...a) {
  const r = await window.uc.adb(a);
  if (r.missing) toast("Не найден scrcpy внутри программы, переустанови UnCam");
  return r;
}

function cur() { return devs.find((d) => d.serial === S.serial); }
function setState(t, kind) {
  const s = $("state");
  s.textContent = t;
  s.className = "state" + (kind ? " " + kind : "");
}
function renderDevs() {
  const box = $("devs");
  box.textContent = "";
  if (!devs.length) {
    box.innerHTML = '<div class="empty">Телефон не найден</div>';
  }
  for (const d of devs) {
    const r = document.createElement("button");
    r.className = "dev" + (d.serial === S.serial ? " on" : "");
    const name = document.createElement("b");
    name.textContent = d.model || "Android";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = d.wifi ? "Wi-Fi" : "USB";
    const sub = document.createElement("small");
    sub.textContent = d.state === "device" ? d.serial : d.state === "unauthorized" ? "Разреши отладку на экране телефона" : "Не в сети";
    r.append(name, tag, sub);
    r.onclick = () => pick(d.serial);
    box.append(r);
  }
  const c = cur();
  $("toWifi").disabled = !c || c.wifi || c.state !== "device";
  $("go").disabled = !running && (!c || c.state !== "device" || !cams.length);
  if (!running) setState(!c ? "Выбери телефон" : c.state !== "device" ? "Телефон не готов" : cams.length ? "Готово к запуску" : "Читаю камеры...");
}
async function poll() {
  if (busy || running) return;
  const r = await adb("devices", "-l");
  if (!r.ok) return;
  devs = UC.parseDevices(r.out);
  if (!cur()) {
    const best = devs.find((d) => d.state === "device" && d.wifi === (S.mode === "wifi")) || devs.find((d) => d.state === "device");
    if (best) return pick(best.serial);
  }
  renderDevs();
  const c = cur();
  if (c && c.state === "device" && !cams.length) loadCams();
}
function pick(serial) {
  S.serial = serial;
  save();
  cams = camCache[serial] || [];
  renderDevs();
  renderCams();
  if (!cams.length) loadCams();
}
async function loadCams() {
  const serial = S.serial;
  if (loadCams.busy === serial) return;
  loadCams.busy = serial;
  const r = await window.uc.cams(serial);
  loadCams.busy = null;
  const list = UC.parseCams(r.out);
  if (!list.length) {
    log(r.out);
    setState(/Android 12|API/.test(r.out) ? "Нужен Android 12 или новее" : "Не удалось прочитать камеры, смотри журнал", "err");
    return;
  }
  camCache[serial] = list;
  if (S.serial !== serial) return;
  cams = list;
  renderCams();
  renderDevs();
}
const FACING = { back: "Основная", front: "Фронтальная", external: "Внешняя" };
function camName(c) {
  const same = cams.filter((x) => x.facing === c.facing);
  const n = same.indexOf(c);
  return (FACING[c.facing] || c.facing) + (n > 0 ? " " + (n + 1) : "");
}
function renderCams() {
  const box = $("cams");
  box.textContent = "";
  $("camCard").classList.toggle("off", !cams.length);
  if (!cams.length) return;
  if (!cams.some((c) => c.id === S.cam)) S.cam = (cams.find((c) => c.facing === "back") || cams[0]).id;
  for (const c of cams) {
    const b = document.createElement("button");
    b.className = "chip" + (c.id === S.cam ? " on" : "");
    const t = document.createElement("span");
    t.textContent = camName(c);
    const s = document.createElement("small");
    s.textContent = "до " + Math.max(...c.fps, ...c.high.flatMap((h) => h.fps)) + " fps";
    b.append(t, s);
    b.onclick = () => { S.cam = c.id; save(); renderCams(); };
    box.append(b);
  }
  const c = cams.find((x) => x.id === S.cam);
  $("camInfo").textContent = "сенсор " + c.sensor;
  const sizes = [...new Set([...c.sizes, ...c.high.map((h) => h.size)])].sort((a, b) => b.split("x")[0] * b.split("x")[1] - a.split("x")[0] * a.split("x")[1]);
  if (!sizes.includes(S.size)) S.size = sizes.find((s) => s === "1920x1080") || sizes.find((s) => +s.split("x")[0] <= 1920) || sizes[0] || "";
  const sel = $("size");
  sel.textContent = "";
  for (const s of sizes) {
    const o = document.createElement("option");
    o.value = s;
    const [w, h] = s.split("x");
    o.textContent = s + (h === "2160" ? "  4K" : h === "1080" ? "  Full HD" : h === "720" ? "  HD" : "");
    sel.append(o);
  }
  sel.value = S.size;
  sel.onchange = () => { S.size = sel.value; save(); renderFps(); };
  renderFps();
  const z = $("zoom");
  $("zoomRow").hidden = !c.zoom;
  if (c.zoom) {
    z.min = c.zoom[0];
    z.max = Math.min(c.zoom[1], 10);
    S.zoom = Math.min(Math.max(S.zoom, c.zoom[0]), +z.max);
    z.value = S.zoom;
    $("zoomV").textContent = (+S.zoom).toFixed(1) + "x";
  }
}
function fpsList() {
  const c = cams.find((x) => x.id === S.cam);
  if (!c) return { normal: [], high: [] };
  const normal = c.fps.filter((f) => f >= 24);
  const h = c.high.find((x) => x.size === S.size);
  const high = h ? h.fps.filter((f) => !normal.includes(f)) : [];
  return { normal: c.sizes.includes(S.size) ? normal : [], high };
}
function renderFps() {
  const { normal, high } = fpsList();
  const all = [...normal, ...high];
  const box = $("fpsSel");
  box.textContent = "";
  if (!all.includes(+S.fps)) S.fps = all.includes(60) ? 60 : Math.max(...normal, 0) || all[0] || 30;
  for (const f of all) {
    const b = document.createElement("button");
    b.dataset.v = f;
    b.textContent = f + (high.includes(f) ? " HS" : "");
    if (high.includes(f)) b.title = "Скоростная съёмка: только в этом разрешении, без зума";
    box.append(b);
  }
  seg(box, S.fps, (v) => { S.fps = +v; save(); });
  save();
}

function setMode(m) {
  S.mode = m;
  save();
  $("usbBox").hidden = m !== "usb";
  $("wifiBox").hidden = m !== "wifi";
  const br = m === "wifi" ? S.brwifi : S.brusb;
  $("br").value = br;
  $("brV").textContent = br + " Мбит/с";
}
async function connect(addr) {
  if (!/:\d+$/.test(addr)) addr += ":5555";
  busy = true;
  const r = await adb("connect", addr);
  busy = false;
  const ok = /connected to/.test(r.out) && !/cannot|failed/i.test(r.out);
  toast(ok ? "Подключено по Wi-Fi" : "Не подключилось: " + r.out.trim().slice(0, 120));
  log(r.out);
  if (ok) {
    S.addr = addr;
    S.serial = addr;
    save();
    cams = [];
  }
  poll();
  return ok;
}

$("refresh").onclick = () => { camCache = {}; cams = []; poll(); };
seg($("mode"), S.mode, setMode);
$("addr").value = S.addr;
$("conn").onclick = () => { const a = $("addr").value.trim(); if (a) connect(a); };
$("addr").onkeydown = (e) => { if (e.key === "Enter") $("conn").click(); };
$("scan").onclick = async () => {
  busy = true;
  $("scan").disabled = true;
  const r = await adb("mdns", "services");
  busy = false;
  $("scan").disabled = false;
  log(r.out);
  const found = UC.parseMdns(r.out);
  const c = found.find((x) => x.kind === "connect");
  const p = found.find((x) => x.kind === "pairing");
  if (p) {
    $("paddr").value = p.addr;
    $("pairBox").open = true;
  }
  if (c) return connect(c.addr);
  toast(p ? "Телефон ждёт сопряжения, введи код" : "Не нашёл. Проверь, что Отладка по Wi-Fi включена и сеть одна");
};
$("pair").onclick = async () => {
  const a = $("paddr").value.trim(), code = $("pcode").value.trim();
  if (!a || !/^\d{6}$/.test(code)) return toast("Нужен адрес и 6 цифр кода");
  busy = true;
  const r = await adb("pair", a, code);
  busy = false;
  log(r.out);
  if (/Successfully paired/i.test(r.out)) {
    toast("Сопряжено, ищу телефон...");
    $("pairBox").open = false;
    setTimeout(() => $("scan").click(), 1500);
  } else toast("Не вышло: " + r.out.trim().slice(0, 120));
};
$("toWifi").onclick = async () => {
  const c = cur();
  if (!c) return;
  busy = true;
  $("toWifi").disabled = true;
  const ip = UC.parseIp((await adb("-s", c.serial, "shell", "ip -f inet addr show wlan0")).out);
  if (!ip) { busy = false; renderDevs(); return toast("Телефон не подключён к Wi-Fi"); }
  await adb("-s", c.serial, "tcpip", "5555");
  await new Promise((r) => setTimeout(r, 2000));
  busy = false;
  $("addr").value = ip + ":5555";
  seg($("mode"), "wifi", setMode);
  setMode("wifi");
  if (await connect(ip + ":5555")) toast("Готово, кабель можно отключить");
};

$("br").oninput = () => {
  const v = +$("br").value;
  S[S.mode === "wifi" ? "brwifi" : "brusb"] = v;
  $("brV").textContent = v + " Мбит/с";
  save();
};
seg($("codec"), S.codec, (v) => { S.codec = v; save(); vcUi(); });
seg($("rot"), S.rot, (v) => { S.rot = v; save(); pushView(); });
$("zoom").oninput = () => { S.zoom = +$("zoom").value; $("zoomV").textContent = S.zoom.toFixed(1) + "x"; save(); };
function pushView() {
  const v = { rot: S.rot, mirror: S.mirror };
  player.setView(v);
  window.uc.view(v);
  try { localStorage.setItem("ucView", JSON.stringify(v)); } catch {}
}
for (const k of ["mirror", "torch"]) {
  $(k).checked = !!S[k];
  $(k).onchange = () => { S[k] = $(k).checked; save(); if (k === "mirror") pushView(); };
}

function onFps(f) {
  if (!running) return;
  $("fps").textContent = f;
  const bd = $("badge");
  bd.classList.toggle("good", f >= target * 0.95);
  bd.classList.toggle("low", f > 0 && f < target * 0.8);
  if (f > 0) document.body.classList.add("play");
}
function stopped() {
  running = false;
  document.body.classList.remove("run", "play");
  $("go").textContent = "Запустить камеру";
  player.clear();
}
$("go").onclick = async () => {
  if (running) return window.uc.stop();
  const c = cur();
  if (!c) return;
  const { high } = fpsList();
  const hs = high.includes(+S.fps);
  target = +S.fps;
  running = true;
  torchOn = !!S.torch;
  $("torchBtn").classList.toggle("on", torchOn);
  document.body.classList.add("run");
  $("go").textContent = "Остановить";
  $("go").disabled = false;
  $("fps").textContent = "0";
  setState("Запускается...");
  pushView();
  const ok = await window.uc.start({ serial: c.serial, cam: S.cam, size: S.size, fps: +S.fps, high: hs, bitrate: S.mode === "wifi" || c.wifi ? S.brwifi : S.brusb, codec: S.codec, zoom: hs ? 1 : S.zoom, torch: S.torch, vcam: S.vcam && vcOk });
  if (!ok && running) { stopped(); setState("Не удалось запустить, смотри журнал", "err"); }
};
let vcOk = false;
function vcUi() {
  $("vcam").checked = S.vcam;
  $("vcInstall").hidden = vcOk;
  $("vcText").textContent = !vcOk ? "Камера ещё не установлена. Нужно один раз, Windows спросит права администратора." : !S.vcam ? "Выключена: видео только в окне UnCam." : S.codec !== "h264" ? "Работает только с кодеком H.264, переключи кодек." : "В Discord, Vela или браузере выбери камеру «UnCam». Работает, пока здесь идёт трансляция.";
}
$("vcam").onchange = () => { S.vcam = $("vcam").checked; save(); vcUi(); };
$("vcInstall").onclick = async () => {
  $("vcInstall").disabled = true;
  $("vcText").textContent = "Подтверди установку в окне Windows...";
  vcOk = await window.uc.vcamState() || await window.uc.vcamInstall();
  $("vcInstall").disabled = false;
  vcUi();
  toast(vcOk ? "Камера UnCam установлена" : "Установка отменена");
};
window.uc.vcamState().then((ok) => { vcOk = ok; vcUi(); });
$("zin").onclick = () => window.uc.ctl("zin");
$("zout").onclick = () => window.uc.ctl("zout");
$("torchBtn").onclick = () => { torchOn = !torchOn; $("torchBtn").classList.toggle("on", torchOn); window.uc.ctl(torchOn ? "torch1" : "torch0"); };
window.uc.onV((ev) => {
  player.feed(ev);
  if (ev.t === "codec" && ev.name !== "error") setState("Идёт трансляция", "ok");
});
window.uc.onLog((l) => {
  log(l);
  if (/ERROR/.test(l) && running) setState(l.replace(/^.*ERROR:\s*/, "").slice(0, 160), "err");
});
window.uc.onExit((code) => {
  const wasErr = $("state").classList.contains("err");
  stopped();
  if (code && !wasErr) setState("Камера остановилась с ошибкой, смотри журнал", "err");
  else if (!wasErr) renderDevs();
  poll();
});
window.uc.onUpdate((o) => {
  const u = $("upd");
  u.hidden = false;
  if (o.s === "load") u.textContent = "Качаю обновление " + o.v;
  if (o.s === "ready") {
    u.textContent = "Обновить до " + o.v;
    u.classList.add("btn");
    u.onclick = () => window.uc.restart();
  }
});
for (const b of document.querySelectorAll("[data-w]")) b.onclick = () => window.uc.win(b.dataset.w);
setMode(S.mode);
pushView();
renderCams();
poll();
setInterval(poll, 2500);
