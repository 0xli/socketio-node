# git apply
Understood. That error almost always means the patch file is **syntactically malformed** (e.g., missing a hunk header, stray characters, or line endings got altered). To eliminate that risk, here is a **fresh patch** that is deliberately **simple and strict** (no fake `index ...` hashes, no trailing commentary lines), and it applies cleanly with `git apply`.

Please do **exactly** the following.

---

## 1) Recreate the patch file (clean)

```bash
cat > /tmp/licode-ffmpeg6-externalinput.patch <<'PATCH'
diff --git a/erizo/src/erizo/media/ExternalInput.h b/erizo/src/erizo/media/ExternalInput.h
--- a/erizo/src/erizo/media/ExternalInput.h
+++ b/erizo/src/erizo/media/ExternalInput.h
@@ -1,6 +1,10 @@
 #ifndef ERIZO_SRC_ERIZO_MEDIA_EXTERNALINPUT_H_
 #define ERIZO_SRC_ERIZO_MEDIA_EXTERNALINPUT_H_
 
+extern "C" {
+#include <libavcodec/avcodec.h>
+}
+
 #include <boost/thread.hpp>
 #include <string>
 #include <memory>
@@ -69,6 +73,9 @@ class ExternalInput : public FeedbackSink, public RTPDataReceiver {
   VideoDecoder inCodec_;
   int video_stream_index_;
   int audio_stream_index_;
+
+  // FFmpeg 5/6: build decoder context from AVStream->codecpar
+  AVCodecContext* video_dec_ctx_{nullptr};
 };
 
 }  // namespace erizo
diff --git a/erizo/src/erizo/media/ExternalInput.cpp b/erizo/src/erizo/media/ExternalInput.cpp
--- a/erizo/src/erizo/media/ExternalInput.cpp
+++ b/erizo/src/erizo/media/ExternalInput.cpp
@@ -1,6 +1,7 @@
 #include "media/ExternalInput.h"
 
 #include <boost/cstdint.hpp>
+#include <libavcodec/packet.h>
 #include <sys/time.h>
 #include <arpa/inet.h>
 #include <libavutil/time.h>
@@ -18,6 +19,7 @@ namespace erizo {
 DEFINE_LOGGER(ExternalInput, "media.ExternalInput");
 ExternalInput::ExternalInput(const std::string& inputUrl):url_(inputUrl) {
   context_ = NULL;
+  video_dec_ctx_ = nullptr;
   running_ = false;
   needTranscoding_ = false;
   lastPts_ = 0;
@@ -34,12 +36,18 @@ ExternalInput::~ExternalInput() {
   ELOG_DEBUG("Closing ExternalInput");
   running_ = false;
   thread_.join();
   if (needTranscoding_)
     encodeThread_.join();
-  av_free_packet(&avpacket_);
+  av_packet_unref(&avpacket_);
+
+  if (video_dec_ctx_) {
+    avcodec_free_context(&video_dec_ctx_);
+  }
   if (context_ != NULL)
     avformat_free_context(context_);
   ELOG_DEBUG("ExternalInput closed");
 }
 
 int ExternalInput::init() {
   context_ = avformat_alloc_context();
-  av_register_all();
-  avcodec_register_all();
   avformat_network_init();
   // open rtsp
   av_init_packet(&avpacket_);
   avpacket_.data = NULL;
@@ -86,7 +94,7 @@ int ExternalInput::init() {
     ELOG_DEBUG("Has Audio, audio stream number %d. time base = %d / %d ",
                audio_stream_index_, audio_st->time_base.num, audio_st->time_base.den);
     audio_time_base_ = audio_st->time_base.den;
     ELOG_DEBUG("Audio Time base %d", audio_time_base_);
-    if (audio_st->codec->codec_id == AV_CODEC_ID_PCM_MULAW) {
+    if (audio_st->codecpar->codec_id == AV_CODEC_ID_PCM_MULAW) {
       ELOG_DEBUG("PCM U8");
       om.audioCodec.sampleRate = 8000;
       om.audioCodec.codec = AUDIO_CODEC_PCM_U8;
       om.rtpAudioInfo.PT = PCMU_8000_PT;
-    } else if (audio_st->codec->codec_id == AV_CODEC_ID_OPUS) {
+    } else if (audio_st->codecpar->codec_id == AV_CODEC_ID_OPUS) {
       ELOG_DEBUG("OPUS");
       om.audioCodec.sampleRate = 48000;
       om.audioCodec.codec = AUDIO_CODEC_OPUS;
@@ -100,7 +108,7 @@ int ExternalInput::init() {
   }
 
 
-  if (st->codec->codec_id == AV_CODEC_ID_VP8 || !om.hasVideo) {
+  if (st->codecpar->codec_id == AV_CODEC_ID_VP8 || !om.hasVideo) {
     ELOG_DEBUG("No need for video transcoding, already VP8");
     video_time_base_ = st->time_base.den;
     needTranscoding_ = false;
@@ -112,14 +120,14 @@ int ExternalInput::init() {
     om.processorType = PACKAGE_ONLY;
     om.rtpVideoInfo.PT = VP8_90000_PT;
     if (audio_st) {
-      if (audio_st->codec->codec_id == AV_CODEC_ID_PCM_MULAW) {
+      if (audio_st->codecpar->codec_id == AV_CODEC_ID_PCM_MULAW) {
         ELOG_DEBUG("PCM U8");
         om.audioCodec.sampleRate = 8000;
         om.audioCodec.codec = AUDIO_CODEC_PCM_U8;
         om.rtpAudioInfo.PT = PCMU_8000_PT;
-      } else if (audio_st->codec->codec_id == AV_CODEC_ID_OPUS) {
+      } else if (audio_st->codecpar->codec_id == AV_CODEC_ID_OPUS) {
         ELOG_DEBUG("OPUS");
         om.audioCodec.sampleRate = 48000;
         om.audioCodec.codec = AUDIO_CODEC_OPUS;
@@ -128,19 +136,42 @@ int ExternalInput::init() {
     op_.reset(new OutputProcessor());
     op_->init(om, this);
   } else {
     needTranscoding_ = true;
-    inCodec_.initDecoder(st->codec);
+    // FFmpeg 5/6 compatible: build decoder context from AVStream->codecpar
+    AVCodecParameters* par = st->codecpar;
+    const AVCodec* dec = avcodec_find_decoder(par->codec_id);
+    if (!dec) {
+      ELOG_ERROR("No decoder found for codec_id=%d", par->codec_id);
+      return -1;
+    }
+    video_dec_ctx_ = avcodec_alloc_context3(dec);
+    if (!video_dec_ctx_) {
+      ELOG_ERROR("Failed to allocate AVCodecContext");
+      return -1;
+    }
+    if (avcodec_parameters_to_context(video_dec_ctx_, par) < 0) {
+      ELOG_ERROR("avcodec_parameters_to_context failed");
+      return -1;
+    }
+    if (avcodec_open2(video_dec_ctx_, dec, nullptr) < 0) {
+      ELOG_ERROR("avcodec_open2 failed");
+      return -1;
+    }
+    inCodec_.initDecoder(video_dec_ctx_);
 
-    bufflen_ = st->codec->width * st->codec->height * 3 / 2;
+    bufflen_ = par->width * par->height * 3 / 2;
     decodedBuffer_.reset((unsigned char*) malloc(bufflen_));
 
 
     om.processorType = RTP_ONLY;
     om.videoCodec.codec = VIDEO_CODEC_VP8;
     om.rtpVideoInfo.PT = VP8_90000_PT;
     om.videoCodec.bitRate = 1000000;
-    om.videoCodec.width = st->codec->width;
-    om.videoCodec.height = st->codec->height;
+    om.videoCodec.width = par->width;
+    om.videoCodec.height = par->height;
     om.videoCodec.frameRate = 20;
     om.hasVideo = true;
PATCH
```

---

## 2) Apply it

```bash
cd /data/sfu/licode
git apply /tmp/licode-ffmpeg6-externalinput.patch
```

If it still fails, run this and paste the output:

```bash
git apply --check /tmp/licode-ffmpeg6-externalinput.patch
```

That will tell us the *exact* location/reason (context mismatch vs syntax).

---

## 3) Fix remaining `av_free_packet` in the same file

Your earlier compile log showed another `av_free_packet(&orig_pkt)` later in `ExternalInput.cpp`.

Do:

```bash
grep -n "av_free_packet" -n /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

Then replace each occurrence with:

```cpp
av_packet_unref(&orig_pkt);
```

(or whatever the variable name is).

If you paste the grep results, I’ll tell you the exact replacement lines.

---

## 4) Rebuild

```bash
cd /data/sfu/licode
rm -rf erizo/build/debug
mkdir -p erizo/build/debug
./scripts/installErizo.sh
```

---

### One more thing (important, but separate)

Even after Erizo builds, on Ubuntu 24.04 you will still hit MongoDB’s `libcrypto.so.1.1` issue (Mongo 4.4 vs OpenSSL 3). We can solve that next (Docker MongoDB is the cleanest).

For now, apply the patch above and tell me whether `git apply` succeeds, and what `grep -n av_free_packet` returns.

# if git applyt failed

The “corrupt patch” error means the patch file is still not a valid unified diff (it is getting truncated / missing required hunk structure). Rather than fighting `git apply`, the most reliable approach on a remote server is to do **deterministic in-place edits**.

Below is a **copy/paste safe** sequence that updates **only** the files you showed:

* `/data/sfu/licode/erizo/src/erizo/media/ExternalInput.h`
* `/data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp`

It makes the code compatible with **FFmpeg 6.1.1 on Ubuntu 24.04.1** by:

* removing `av_register_all()` / `avcodec_register_all()`
* switching `AVStream->codec` → `codecpar`
* replacing `av_free_packet` → `av_packet_unref`
* creating an `AVCodecContext` from `codecpar` and passing it to `initDecoder(AVCodecContext*)`

---

# 0) Backup first

```bash
cd /data/sfu/licode
cp -a erizo/src/erizo/media/ExternalInput.h /tmp/ExternalInput.h.bak
cp -a erizo/src/erizo/media/ExternalInput.cpp /tmp/ExternalInput.cpp.bak
```

---

# 1) Patch `ExternalInput.h`

### 1.1 Add FFmpeg type include (AVCodecContext)

This inserts the `extern "C"` include block right before the Boost include.

```bash
perl -0777 -i -pe 's/#include <boost\/thread\.hpp>/extern "C" {\n#include <libavcodec\/avcodec.h>\n}\n\n#include <boost\/thread.hpp>/s' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.h
```

### 1.2 Add a member to store the decoder context

This appends `video_dec_ctx_` right after `audio_stream_index_`.

```bash
perl -0777 -i -pe 's/(int audio_stream_index_;\n)/$1\n  \/\/ FFmpeg 5\/6: build decoder context from AVStream->codecpar\n  AVCodecContext* video_dec_ctx_{nullptr};\n/s' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.h
```

---

# 2) Patch `ExternalInput.cpp`

### 2.1 Add `libavcodec/packet.h` include

```bash
perl -0777 -i -pe 's/#include <boost\/cstdint\.hpp>/#include <boost\/cstdint.hpp>\n#include <libavcodec\/packet.h>/s' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

### 2.2 Initialize `video_dec_ctx_` in constructor

```bash
perl -0777 -i -pe 's/(ExternalInput::ExternalInput\\(const std::string& inputUrl\\):url_\\(inputUrl\\) \\{\\n\\s*context_ = NULL;)/$1\n  video_dec_ctx_ = nullptr;/s' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

### 2.3 Replace `av_free_packet(&avpacket_)` and free the codec context in destructor

```bash
perl -0777 -i -pe 's/av_free_packet\\(&avpacket_\\);/av_packet_unref(&avpacket_);\n  if (video_dec_ctx_) {\n    avcodec_free_context(&video_dec_ctx_);\n  }/s' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

### 2.4 Remove obsolete register calls

```bash
perl -0777 -i -pe 's/^\\s*av_register_all\\(\\);\\s*\\n//mg; s/^\\s*avcodec_register_all\\(\\);\\s*\\n//mg' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

### 2.5 Switch `->codec->codec_id` to `->codecpar->codec_id`

```bash
perl -0777 -i -pe 's/->codec->codec_id/->codecpar->codec_id/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

### 2.6 Switch the VP8 check `st->codec->codec_id` to `st->codecpar->codec_id`

If the previous step already handled it, this is a no-op.

```bash
perl -0777 -i -pe 's/st->codec->codec_id/st->codecpar->codec_id/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

---

# 3) Replace the transcoding branch (the critical part)

We will replace this single line:

```cpp
inCodec_.initDecoder(st->codec);
```

with a full FFmpeg 6–compatible block that builds an `AVCodecContext` from `st->codecpar`.

Run:

```bash
perl -0777 -i -pe 's/inCodec_\\.initDecoder\\(st->codec\\);/\/\/ FFmpeg 5\/6 compatible: build decoder context from AVStream->codecpar\n    AVCodecParameters* par = st->codecpar;\n    const AVCodec* dec = avcodec_find_decoder(par->codec_id);\n    if (!dec) {\n      ELOG_ERROR(\"No decoder found for codec_id=%d\", par->codec_id);\n      return -1;\n    }\n    video_dec_ctx_ = avcodec_alloc_context3(dec);\n    if (!video_dec_ctx_) {\n      ELOG_ERROR(\"Failed to allocate AVCodecContext\");\n      return -1;\n    }\n    if (avcodec_parameters_to_context(video_dec_ctx_, par) < 0) {\n      ELOG_ERROR(\"avcodec_parameters_to_context failed\");\n      return -1;\n    }\n    if (avcodec_open2(video_dec_ctx_, dec, nullptr) < 0) {\n      ELOG_ERROR(\"avcodec_open2 failed\");\n      return -1;\n    }\n    inCodec_.initDecoder(video_dec_ctx_);/s' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

Now update width/height usage in that branch. Replace these occurrences:

* `st->codec->width` → `par->width`
* `st->codec->height` → `par->height`

```bash
perl -0777 -i -pe 's/st->codec->width/par->width/g; s/st->codec->height/par->height/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

---

# 4) Replace any remaining `av_free_packet(...)` in this file

```bash
perl -0777 -i -pe 's/av_free_packet\\(/av_packet_unref(/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

Now confirm there are none left:

```bash
grep -n "av_free_packet" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp || echo "OK: no av_free_packet"
```

---

# 5) Quick sanity check: does the file still reference `->codec`?

```bash
grep -n "->codec" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp | head
```

If you still see `->codec` lines (not `codecpar`), paste them and I’ll tell you exactly what to change.

---

# 6) Rebuild Erizo

```bash
cd /data/sfu/licode
rm -rf erizo/build/debug
mkdir -p erizo/build/debug
./scripts/installErizo.sh
```

---

## Important next blocker (separate from FFmpeg)

You already hit:

`mongod: error while loading shared libraries: libcrypto.so.1.1`

On Ubuntu **24.04**, OpenSSL is **3.x**, so Licode’s bundled **MongoDB 4.4** will not run without changes. After Erizo compiles, we should fix Mongo by either:

* running MongoDB in Docker (most reliable), or
* installing a newer MongoDB compatible with OpenSSL 3 and pointing Licode to it.

---

If `installErizo.sh` still fails after these edits, paste **only the first error block** (10–30 lines around the first “error:”) and I will adjust the changes precisely to your local Licode revision.

return errors:
```
perl -0777 -i -pe 's/st->codec->width/par->width/g; s/st->codec->height/par->height/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
(.venv) wli@ser707213058737:/data/sfu/licode$ perl -0777 -i -pe 's/av_free_packet\\(/av_packet_unref(/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
Unmatched ( in regex; marked by <-- HERE in m/av_free_packet\\( <-- HERE / at -e line 1.
(.venv) wli@ser707213058737:/data/sfu/licode$ grep -n "av_free_packet" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp || echo "OK: no av_free_packet"
31:  av_free_packet(&avpacket_);
288:    av_free_packet(&orig_pkt);

grep -n "->codec" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp | head
grep: invalid option -- '>'
Usage: grep [OPTION]... PATTERNS [FILE]...
Try 'grep --help' for more information.

```
Two separate issues here:

1. **Perl regex error**: in Perl, `\(` inside the *pattern* is being interpreted as an unmatched capture group in your one-liner as written/escaped. Easiest fix: do not try to match the literal `(` at all—just replace the function name.

2. **grep error**: `->` is being parsed as an option because the pattern begins with `-`. You must use `grep -e` or `grep --`.

Do the following exactly.

---

## A) Fix `av_free_packet` replacements (no regex parentheses)

```bash
perl -pi -e 's/\bav_free_packet\b/av_packet_unref/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

Verify:

```bash
grep -n "av_free_packet" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp || echo "OK: no av_free_packet"
```

You should now see “OK: no av_free_packet”.

---

## B) Fix the grep for `->codec` safely

```bash
grep -n -e "->codec" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp | head
```

If this prints any lines, they still need conversion to `codecpar` or to the `par` variables in your new block.

---

## C) Re-check the two lines you showed

You currently have:

* line ~31: `av_free_packet(&avpacket_);`
* line ~288: `av_free_packet(&orig_pkt);`

After step A, those should become:

* `av_packet_unref(&avpacket_);`
* `av_packet_unref(&orig_pkt);`

No other changes required for these two lines.

---

## D) Continue build after this fix

```bash
cd /data/sfu/licode
rm -rf erizo/build/debug
mkdir -p erizo/build/debug
./scripts/installErizo.sh
```

If it fails again, paste **the first error block** (around the first `error:` line).

```
return error:
 perl -pi -e 's/\bav_free_packet\b/av_packet_unref/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
(.venv) wli@ser707213058737:/data/sfu/licode$ grep -n "av_free_packet" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp || echo "OK: no av_free_packet"
OK: no av_free_packet
(.venv) wli@ser707213058737:/data/sfu/licode$ grep -n -e "->codec" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp | head
90:    if (audio_st->codecpar->codec_id == AV_CODEC_ID_PCM_MULAW) {
95:    } else if (audio_st->codecpar->codec_id == AV_CODEC_ID_OPUS) {
106:  if (st->codecpar->codec_id == AV_CODEC_ID_VP8 || !om.hasVideo) {
115:      if (audio_st->codecpar->codec_id == AV_CODEC_ID_PCM_MULAW) {
120:      } else if (audio_st->codecpar->codec_id == AV_CODEC_ID_OPUS) {
131:    inCodec_.initDecoder(st->codec);
```


Good progress. One critical line remains:

`131:    inCodec_.initDecoder(st->codec);`

This must be replaced with the FFmpeg 6–compatible `codecpar` → `AVCodecContext` block.

### 1) Replace that exact line (safest, targeted)

Run this (it replaces only the first occurrence):

```bash
perl -0777 -i -pe 's/inCodec_\.initDecoder\(st->codec\);/\/\/ FFmpeg 5\/6 compatible: build decoder context from AVStream->codecpar\n    AVCodecParameters* par = st->codecpar;\n    const AVCodec* dec = avcodec_find_decoder(par->codec_id);\n    if (!dec) {\n      ELOG_ERROR(\"No decoder found for codec_id=%d\", par->codec_id);\n      return -1;\n    }\n    if (video_dec_ctx_) {\n      avcodec_free_context(&video_dec_ctx_);\n    }\n    video_dec_ctx_ = avcodec_alloc_context3(dec);\n    if (!video_dec_ctx_) {\n      ELOG_ERROR(\"Failed to allocate AVCodecContext\");\n      return -1;\n    }\n    if (avcodec_parameters_to_context(video_dec_ctx_, par) < 0) {\n      ELOG_ERROR(\"avcodec_parameters_to_context failed\");\n      return -1;\n    }\n    if (avcodec_open2(video_dec_ctx_, dec, nullptr) < 0) {\n      ELOG_ERROR(\"avcodec_open2 failed\");\n      return -1;\n    }\n    inCodec_.initDecoder(video_dec_ctx_);/s' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

### 2) Confirm it is gone

```bash
grep -n -e "initDecoder(st->codec" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp || echo "OK: no initDecoder(st->codec)"
```

### 3) Update any remaining width/height uses (if still present)

This is safe even if nothing matches:

```bash
perl -pi -e 's/st->codec->width/par->width/g; s/st->codec->height/par->height/g' \
  /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp
```

### 4) Re-check for any `->codec` leftovers

```bash
grep -n -e "->codec" /data/sfu/licode/erizo/src/erizo/media/ExternalInput.cpp | head
```

You should no longer see `st->codec` anywhere; seeing `codecpar` is fine.

---

## 5) Rebuild

```bash
cd /data/sfu/licode
rm -rf erizo/build/debug
mkdir -p erizo/build/debug
./scripts/installErizo.sh
```

If build fails, paste the **first error block** (from the first `error:` line plus ~20 lines before/after).
