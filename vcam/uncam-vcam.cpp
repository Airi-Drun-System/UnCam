#include <windows.h>
#include <initguid.h>
#include <mfapi.h>
#include <mftransform.h>
#include <mferror.h>
#include <wmcodecdsp.h>
#include <codecapi.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>
#include <string>
#include <thread>

typedef void* scCamera;
typedef scCamera(__cdecl* CreateFn)(int, int, float);
typedef void(__cdecl* DeleteFn)(scCamera);
typedef void(__cdecl* SendFn)(scCamera, const void*);

static CreateFn scCreateCamera;
static DeleteFn scDeleteCamera;
static SendFn scSendFrame;

template <class T> static void release(T*& p) { if (p) { p->Release(); p = nullptr; } }

static bool readAll(HANDLE h, void* buf, DWORD n) {
    char* p = (char*)buf;
    while (n) {
        DWORD got = 0;
        if (!ReadFile(h, p, n, &got, nullptr) || got == 0) return false;
        p += got;
        n -= got;
    }
    return true;
}

struct Converter {
    int rot = 0;
    bool mirror = false;
    scCamera cam = nullptr;
    int cw = 0, ch = 0;
    std::vector<uint8_t> out;

    void send(const uint8_t* y, const uint8_t* uv, int pitch, int w, int h) {
        bool side = rot == 90 || rot == 270;
        int ow = (side ? h : w) & ~3, oh = (side ? w : h) & ~3;
        if (ow <= 0 || oh <= 0) return;
        if (!cam || ow != cw || oh != ch) {
            if (cam) scDeleteCamera(cam);
            cam = scCreateCamera(ow, oh, 0.0f);
            cw = ow;
            ch = oh;
            out.assign((size_t)ow * oh * 3, 0);
            if (!cam) { fprintf(stderr, "ERROR: virtual camera is busy or not installed\n"); fflush(stderr); }
            else { fprintf(stderr, "vcam %dx%d\n", ow, oh); fflush(stderr); }
        }
        if (!cam) return;
        uint8_t* dst = out.data();
        int R = rot, M = mirror ? 1 : 0;
        auto rows = [&](int y0, int y1) {
        for (int oy = y0; oy < y1; oy++) {
            uint8_t* d = dst + (size_t)oy * ow * 3;
            for (int ox = 0; ox < ow; ox++) {
                int x = M ? ow - 1 - ox : ox, sx, sy;
                if (R == 0) { sx = x; sy = oy; }
                else if (R == 90) { sx = oy; sy = h - 1 - x; }
                else if (R == 180) { sx = w - 1 - x; sy = h - 1 - oy; }
                else { sx = w - 1 - oy; sy = x; }
                int Y = y[(size_t)sy * pitch + sx] - 16;
                const uint8_t* c = uv + (size_t)(sy >> 1) * pitch + (sx & ~1);
                int U = c[0] - 128, V = c[1] - 128;
                int C = 298 * (Y < 0 ? 0 : Y);
                int r = (C + 409 * V + 128) >> 8, g = (C - 100 * U - 208 * V + 128) >> 8, b = (C + 516 * U + 128) >> 8;
                d[0] = (uint8_t)(b < 0 ? 0 : b > 255 ? 255 : b);
                d[1] = (uint8_t)(g < 0 ? 0 : g > 255 ? 255 : g);
                d[2] = (uint8_t)(r < 0 ? 0 : r > 255 ? 255 : r);
                d += 3;
            }
        }
        };
        std::thread th[4];
        for (int i = 0; i < 4; i++) th[i] = std::thread(rows, oh * i / 4, oh * (i + 1) / 4);
        for (auto& x : th) x.join();
        scSendFrame(cam, dst);
    }
};

struct Decoder {
    IMFTransform* mft = nullptr;
    UINT32 fw = 0, fh = 0, dw = 0, dh = 0;
    LONG stride = 0;
    DWORD outSize = 0;
    bool providesSamples = false;

    bool init() {
        if (FAILED(CoCreateInstance(CLSID_CMSH264DecoderMFT, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&mft)))) return false;
        ICodecAPI* api = nullptr;
        if (SUCCEEDED(mft->QueryInterface(IID_PPV_ARGS(&api)))) {
            VARIANT v;
            VariantInit(&v);
            v.vt = VT_UI4;
            v.ulVal = 1;
            api->SetValue(&CODECAPI_AVLowLatencyMode, &v);
            release(api);
        }
        IMFMediaType* in = nullptr;
        MFCreateMediaType(&in);
        in->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        in->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
        in->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        HRESULT hr = mft->SetInputType(0, in, 0);
        release(in);
        if (FAILED(hr)) return false;
        if (!setOutput()) return false;
        mft->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
        mft->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
        return true;
    }

    bool setOutput() {
        for (DWORD i = 0;; i++) {
            IMFMediaType* t = nullptr;
            if (FAILED(mft->GetOutputAvailableType(0, i, &t))) return false;
            GUID sub;
            t->GetGUID(MF_MT_SUBTYPE, &sub);
            if (sub == MFVideoFormat_NV12) {
                HRESULT hr = mft->SetOutputType(0, t, 0);
                MFGetAttributeSize(t, MF_MT_FRAME_SIZE, &fw, &fh);
                UINT32 s = 0;
                stride = SUCCEEDED(t->GetUINT32(MF_MT_DEFAULT_STRIDE, &s)) ? (LONG)s : (LONG)fw;
                MFVideoArea area;
                if (SUCCEEDED(t->GetBlob(MF_MT_MINIMUM_DISPLAY_APERTURE, (UINT8*)&area, sizeof(area), nullptr))) { dw = area.Area.cx; dh = area.Area.cy; }
                else { dw = fw; dh = fh; }
                release(t);
                MFT_OUTPUT_STREAM_INFO info = {};
                mft->GetOutputStreamInfo(0, &info);
                outSize = info.cbSize;
                providesSamples = (info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) != 0;
                return SUCCEEDED(hr);
            }
            release(t);
        }
    }

    void push(const std::vector<uint8_t>& data, LONGLONG t, Converter& conv) {
        IMFSample* s = nullptr;
        IMFMediaBuffer* b = nullptr;
        MFCreateSample(&s);
        MFCreateMemoryBuffer((DWORD)data.size(), &b);
        BYTE* p = nullptr;
        b->Lock(&p, nullptr, nullptr);
        memcpy(p, data.data(), data.size());
        b->Unlock();
        b->SetCurrentLength((DWORD)data.size());
        s->AddBuffer(b);
        s->SetSampleTime(t);
        HRESULT hr = mft->ProcessInput(0, s, 0);
        if (hr == MF_E_NOTACCEPTING) {
            drain(conv);
            mft->ProcessInput(0, s, 0);
        }
        release(b);
        release(s);
        drain(conv);
    }

    void drain(Converter& conv) {
        for (;;) {
            MFT_OUTPUT_DATA_BUFFER ob = {};
            IMFSample* os = nullptr;
            if (!providesSamples) {
                IMFMediaBuffer* mb = nullptr;
                MFCreateSample(&os);
                MFCreateMemoryBuffer(outSize ? outSize : fw * fh * 3 / 2, &mb);
                os->AddBuffer(mb);
                release(mb);
                ob.pSample = os;
            }
            DWORD status = 0;
            HRESULT hr = mft->ProcessOutput(0, 1, &ob, &status);
            if (ob.pEvents) ob.pEvents->Release();
            if (hr == MF_E_TRANSFORM_STREAM_CHANGE) {
                release(os);
                if (ob.pSample && providesSamples) ob.pSample->Release();
                setOutput();
                continue;
            }
            if (FAILED(hr)) {
                release(os);
                return;
            }
            IMFSample* got = ob.pSample;
            IMFMediaBuffer* buf = nullptr;
            if (got && SUCCEEDED(got->ConvertToContiguousBuffer(&buf))) {
                IMF2DBuffer* b2 = nullptr;
                BYTE* base = nullptr;
                LONG pitch = 0;
                if (SUCCEEDED(buf->QueryInterface(IID_PPV_ARGS(&b2))) && SUCCEEDED(b2->Lock2D(&base, &pitch))) {
                    conv.send(base, base + (size_t)pitch * fh, pitch, dw, dh);
                    b2->Unlock2D();
                } else {
                    BYTE* q = nullptr;
                    if (SUCCEEDED(buf->Lock(&q, nullptr, nullptr))) {
                        conv.send(q, q + (size_t)stride * fh, stride, dw, dh);
                        buf->Unlock();
                    }
                }
                release(b2);
                release(buf);
            }
            if (providesSamples && got) got->Release();
            release(os);
        }
    }
};

int main(int argc, char** argv) {
    Converter conv;
    if (argc > 1) conv.rot = atoi(argv[1]);
    if (argc > 2) conv.mirror = atoi(argv[2]) != 0;
    wchar_t dir[MAX_PATH];
    GetModuleFileNameW(nullptr, dir, MAX_PATH);
    std::wstring path(dir);
    path = path.substr(0, path.find_last_of(L"\\/") + 1) + L"softcam.dll";
    HMODULE lib = LoadLibraryW(path.c_str());
    if (!lib) { fprintf(stderr, "ERROR: softcam.dll not found\n"); return 2; }
    scCreateCamera = (CreateFn)GetProcAddress(lib, "scCreateCamera");
    scDeleteCamera = (DeleteFn)GetProcAddress(lib, "scDeleteCamera");
    scSendFrame = (SendFn)GetProcAddress(lib, "scSendFrame");
    if (!scCreateCamera || !scDeleteCamera || !scSendFrame) { fprintf(stderr, "ERROR: bad softcam.dll\n"); return 2; }
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    MFStartup(MF_VERSION, MFSTARTUP_LITE);
    Decoder dec;
    if (!dec.init()) { fprintf(stderr, "ERROR: H.264 decoder unavailable\n"); return 3; }
    fprintf(stderr, "vcam ready\n");
    fflush(stderr);
    HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    std::vector<uint8_t> config, data;
    LONGLONG t = 0;
    for (;;) {
        uint8_t hdr[5];
        if (!readAll(in, hdr, 5)) break;
        uint32_t n = (uint32_t)hdr[1] << 24 | (uint32_t)hdr[2] << 16 | (uint32_t)hdr[3] << 8 | hdr[4];
        data.resize(n);
        if (n && !readAll(in, data.data(), n)) break;
        if (hdr[0] == 1) { config = data; continue; }
        if (hdr[0] == 2 && !config.empty()) data.insert(data.begin(), config.begin(), config.end());
        t += 166666;
        dec.push(data, t, conv);
    }
    if (conv.cam) scDeleteCamera(conv.cam);
    MFShutdown();
    return 0;
}
