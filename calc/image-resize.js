/*!
 * ============================================================
 * 모듈명   : SalimCalc.imageResize
 * 파일     : calc/image-resize.js
 * 용도     : 사진 크기 조절 계산기
 *            - 가로·세로 픽셀 변경, 비율 유지
 *            - 비율 자르기(1:1, 4:3, 16:9, 썸네일, 증명사진 등) + 자르기 위치
 *            - 저장 형식(JPG/PNG/WebP)·화질 변경, 미리보기, 저장
 *            ※ 사진은 서버로 전송하지 않고 사용자 브라우저(Canvas) 안에서만 처리
 * 기준     : 세율·요금 등 법령 기준 없음
 *            cm→px 환산: 1인치 = 2.54cm, 300dpi (인쇄용 사진 일반 환산)
 *            여권 사진 3.5×4.5cm: 외교부 여권안내 공지 규격
 *            기준일 2026-10-05
 * 버전     : 1.0.0
 * 최종수정 : 2026-10-05
 * ============================================================
 */
(function (window, document) {
  'use strict';

  var SalimCalc = window.SalimCalc = window.SalimCalc || {};

  /* ---------- 단위 환산 (CONFIG에서도 사용) ---------- */
  function cmToPx(cm, dpi) {
    var d = dpi > 0 ? dpi : 300;
    return Math.round((cm / 2.54) * d);
  }

  /* ---------- 기준값: 이 객체만 수정하면 됩니다 ---------- */
  var CONFIG = {
    VERSION: '1.0.0',
    UPDATED: '2026-10-05',
    DPI: 300,
    MAX_SIDE: 8000,          // 한 변 최대 픽셀 (구형 모바일 메모리 보호)
    MAX_PIXELS: 16000000,    // 최종 화소 수 상한 (iOS 캔버스 한도보다 낮게)
    MAX_FILE_MB: 40,         // 불러올 원본 최대 용량
    DEFAULT_FORMAT: 'image/jpeg',
    DEFAULT_QUALITY: 85,     // 10~100
    RATIOS: {
      'original': null,
      '1:1': { w: 1, h: 1 },
      '4:3': { w: 4, h: 3 },
      '3:4': { w: 3, h: 4 },
      '3:2': { w: 3, h: 2 },
      '16:9': { w: 16, h: 9 },
      '9:16': { w: 9, h: 16 },
      '1200:630': { w: 1200, h: 630 },
      '7:9': { w: 7, h: 9 }
    },
    RATIO_LABELS: {
      'original': '원본 비율',
      '1:1': '1:1 정사각형',
      '4:3': '4:3 가로',
      '3:4': '3:4 세로(반명함)',
      '3:2': '3:2 가로',
      '16:9': '16:9 와이드',
      '9:16': '9:16 세로 전체화면',
      '1200:630': '1.91:1 썸네일',
      '7:9': '7:9 여권 사진(3.5×4.5cm)'
    },
    PRESETS: {
      blog:     { label: '블로그 본문', ratio: 'original', w: 1200, h: 0, format: 'image/jpeg', quality: 85 },
      doc:      { label: '문서·메일 첨부', ratio: 'original', w: 1024, h: 0, format: 'image/jpeg', quality: 80 },
      thumb:    { label: '블로그 썸네일', ratio: '1200:630', w: 1200, h: 630, format: 'image/jpeg', quality: 85 },
      square:   { label: 'SNS 정사각형', ratio: '1:1', w: 1080, h: 1080, format: 'image/jpeg', quality: 85 },
      passport: { label: '여권 사진 비율', ratio: '7:9', w: cmToPx(3.5, 300), h: cmToPx(4.5, 300), format: 'image/jpeg', quality: 92,
                  note: '배경색·얼굴 크기 등 세부 규정은 발급 기관 안내를 꼭 확인해 주세요.' },
      resume:   { label: '반명함(3×4cm)', ratio: '3:4', w: cmToPx(3, 300), h: cmToPx(4, 300), format: 'image/jpeg', quality: 92 }
    },
    EXT: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
    FORMAT_LABELS: { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' }
  };

  /* ---------- 공통 유틸 ---------- */
  function parseNum(v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return NaN;
    var s = String(v).replace(/[,\s]/g, '');
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function comma(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtSize(w, h) {
    return comma(w) + ' × ' + comma(h) + 'px';
  }

  function formatBytes(b) {
    if (!(b >= 0)) return '-';
    if (b < 1024) return comma(b) + 'B';
    if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
    return (b / 1048576).toFixed(2) + 'MB';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---------- 순수 계산 함수 ----------
   * input  : { srcW, srcH, ratio('4:3' 또는 {w,h}), anchor(0~1),
   *            targetW, targetH, keepRatio(bool), driver('w'|'h') }
   * output : { ok, errors[], warnings[], src, crop{x,y,w,h}, cropped,
   *            out{w,h}, scaleWPct, scaleHPct, stretched, upscaled,
   *            megapixels, ratioLabel, basis }
   */
  function calculate(input) {
    input = input || {};
    var errors = [], warnings = [];
    var srcW = Math.round(parseNum(input.srcW));
    var srcH = Math.round(parseNum(input.srcH));
    if (!(srcW > 0) || !(srcH > 0)) {
      return { ok: false, errors: ['원본 사진의 가로·세로 크기를 확인할 수 없습니다.'], warnings: [] };
    }

    var ratioKey = typeof input.ratio === 'string' ? input.ratio : '';
    var ratio = input.ratio;
    if (typeof ratio === 'string') {
      ratio = CONFIG.RATIOS.hasOwnProperty(ratio) ? CONFIG.RATIOS[ratio] : null;
    }
    if (ratio && !(ratio.w > 0 && ratio.h > 0)) ratio = null;
    var ratioLabel = ratio ? (CONFIG.RATIO_LABELS[ratioKey] || (ratio.w + ':' + ratio.h)) : '원본 비율';

    var anchor = parseNum(input.anchor);
    if (!(anchor >= 0 && anchor <= 1)) anchor = 0.5;

    // 1) 비율 자르기: 원본 안에서 가장 큰 영역을 지정 위치 기준으로 선택
    var crop = { x: 0, y: 0, w: srcW, h: srcH };
    if (ratio) {
      var r = ratio.w / ratio.h;
      if (srcW / srcH > r) {
        crop.w = Math.max(1, Math.min(srcW, Math.round(srcH * r)));
        crop.x = Math.round((srcW - crop.w) * anchor);
      } else {
        crop.h = Math.max(1, Math.min(srcH, Math.round(srcW / r)));
        crop.y = Math.round((srcH - crop.h) * anchor);
      }
    }
    var cropped = crop.w !== srcW || crop.h !== srcH;
    var shapeW = ratio ? ratio.w : crop.w;
    var shapeH = ratio ? ratio.h : crop.h;

    // 2) 목표 크기 검증
    var rawW = parseNum(input.targetW), rawH = parseNum(input.targetH);
    var hasW = isFinite(rawW), hasH = isFinite(rawH);
    if (hasW && rawW < 1) errors.push('가로 크기는 1px 이상으로 입력해 주세요.');
    if (hasH && rawH < 1) errors.push('세로 크기는 1px 이상으로 입력해 주세요.');
    var tW = hasW && rawW >= 1 ? Math.round(rawW) : 0;
    var tH = hasH && rawH >= 1 ? Math.round(rawH) : 0;

    // 3) 최종 크기 결정
    var keep = input.keepRatio !== false;
    var driver = input.driver === 'h' ? 'h' : 'w';
    var outW, outH;
    if (keep) {
      if (driver === 'h' && tH) { outH = tH; outW = Math.round(tH * shapeW / shapeH); }
      else if (tW) { outW = tW; outH = Math.round(tW * shapeH / shapeW); }
      else if (tH) { outH = tH; outW = Math.round(tH * shapeW / shapeH); }
      else { outW = crop.w; outH = crop.h; }
    } else {
      outW = tW || crop.w;
      outH = tH || crop.h;
    }
    outW = Math.max(1, outW);
    outH = Math.max(1, outH);

    if (outW > CONFIG.MAX_SIDE || outH > CONFIG.MAX_SIDE) {
      errors.push('한 변은 최대 ' + comma(CONFIG.MAX_SIDE) + 'px까지 설정할 수 있습니다.');
    } else if (outW * outH > CONFIG.MAX_PIXELS) {
      errors.push('최종 화소 수가 너무 큽니다. 가로·세로를 조금 줄여 주세요.');
    }

    var scaleW = outW / crop.w, scaleH = outH / crop.h;
    var stretched = Math.abs(scaleW - scaleH) / Math.max(scaleW, scaleH) > 0.01;
    var upscaled = scaleW > 1.0001 || scaleH > 1.0001;
    if (upscaled) warnings.push('원본보다 크게 늘리면 선명도가 떨어질 수 있습니다.');
    if (stretched) warnings.push('비율 유지가 꺼져 있어 사진이 늘어나거나 눌려 보일 수 있습니다.');

    var scaleWPct = round1(scaleW * 100), scaleHPct = round1(scaleH * 100);
    var basis = '원본 ' + fmtSize(srcW, srcH) +
      (cropped ? ' → ' + ratioLabel + '로 자르기(' + fmtSize(crop.w, crop.h) + ')' : '') +
      ' → ' + (keep ? '비율 유지' : '지정 크기') +
      ' → 최종 ' + fmtSize(outW, outH) +
      ' (배율 ' + (stretched ? '가로 ' + scaleWPct + '%·세로 ' + scaleHPct + '%' : scaleWPct + '%') + ')';

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
      src: { w: srcW, h: srcH },
      crop: crop,
      cropped: cropped,
      out: { w: outW, h: outH },
      scaleWPct: scaleWPct,
      scaleHPct: scaleHPct,
      stretched: stretched,
      upscaled: upscaled,
      megapixels: Math.round(outW * outH / 10000) / 100,
      ratioLabel: ratioLabel,
      basis: basis
    };
  }

  /* ---------- 캔버스 처리 ---------- */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function setSmooth(ctx) {
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  }

  // 큰 폭으로 줄일 때 계단 현상을 줄이기 위해 절반씩 단계적으로 축소
  function drawResized(img, crop, out, fillWhite) {
    var source = img, sx = crop.x, sy = crop.y, sw = crop.w, sh = crop.h;
    while (sw / 2 >= out.w && sh / 2 >= out.h) {
      var tmp = makeCanvas(Math.round(sw / 2), Math.round(sh / 2));
      var tctx = tmp.getContext('2d');
      setSmooth(tctx);
      tctx.drawImage(source, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
      source = tmp; sx = 0; sy = 0; sw = tmp.width; sh = tmp.height;
    }
    var canvas = makeCanvas(out.w, out.h);
    var ctx = canvas.getContext('2d');
    setSmooth(ctx);
    if (fillWhite) { // JPG는 투명 배경이 검게 나오므로 흰색으로 채움
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.w, out.h);
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.w, out.h);
    return canvas;
  }

  var typeSupportCache = {};
  function supportsType(type) {
    if (typeSupportCache.hasOwnProperty(type)) return typeSupportCache[type];
    var ok = false;
    try { ok = makeCanvas(1, 1).toDataURL(type).indexOf('data:' + type) === 0; } catch (e) { ok = false; }
    typeSupportCache[type] = ok;
    return ok;
  }

  function canvasToBlob(canvas, type, quality, cb) {
    if (canvas.toBlob) {
      canvas.toBlob(function (b) { cb(b); }, type, quality);
      return;
    }
    try {
      var data = canvas.toDataURL(type, quality);
      var parts = data.split(',');
      var mime = parts[0].match(/:(.*?);/)[1];
      var bin = window.atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      cb(new Blob([arr], { type: mime }));
    } catch (e) {
      cb(null);
    }
  }

  function makeFileName(original, w, h, type) {
    var base = String(original || 'photo').replace(/\.[^.]+$/, '').replace(/[\\\/:*?"<>|]/g, '_') || 'photo';
    return base + '_' + w + 'x' + h + '.' + (CONFIG.EXT[type] || 'jpg');
  }

  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn, false); }

  /* ---------- DOM 바인딩 ---------- */
  function init(selector) {
    var root = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!root) return null;
    if (root.getAttribute('data-sc-ready') === '1') return root.salimApi || null;

    var names = ['body', 'loading', 'file', 'drop', 'info', 'ratio', 'anchor', 'w', 'h',
                 'keep', 'format', 'quality', 'qval', 'plan', 'run', 'reset', 'msg', 'result'];
    var el = {};
    for (var i = 0; i < names.length; i++) {
      el[names[i]] = root.querySelector('[data-sc="' + names[i] + '"]');
    }
    var presetBtns = root.querySelectorAll('[data-sc="preset"]');

    if (!el.body || !el.file || !document.createElement('canvas').getContext) {
      if (el.loading) {
        el.loading.textContent = '이 브라우저에서는 사진 크기 조절 기능을 사용할 수 없습니다. 최신 크롬·사파리·엣지에서 열어 주세요.';
        el.loading.className += ' is-error';
      }
      return null;
    }

    var state = { img: null, file: null, driver: 'w', srcUrl: null, outUrl: null, busy: false };

    function showMsg(text, isError) {
      if (!el.msg) return;
      el.msg.textContent = text || '';
      el.msg.className = 'sc-msg' + (text ? (isError ? ' is-error' : ' is-ok') : '');
    }

    function readInput() {
      var opt = el.ratio.options[el.ratio.selectedIndex];
      return {
        srcW: state.img ? state.img.w : 0,
        srcH: state.img ? state.img.h : 0,
        ratio: el.ratio.value,
        ratioText: opt ? opt.text : '',
        anchor: el.anchor ? el.anchor.value : 0.5,
        targetW: el.w.value,
        targetH: el.h.value,
        keepRatio: el.keep ? el.keep.checked : true,
        driver: state.driver
      };
    }

    function updatePlan() {
      if (!el.plan) return;
      if (!state.img) {
        el.plan.innerHTML = '사진을 선택하면 최종 크기가 여기에 미리 표시됩니다.';
        return;
      }
      var res = calculate(readInput());
      if (!res.out) { el.plan.textContent = res.errors.join(' '); return; }
      var html = '예상 결과 <strong>' + fmtSize(res.out.w, res.out.h) + '</strong>' +
        ' · 배율 ' + (res.stretched ? '가로 ' + res.scaleWPct + '% / 세로 ' + res.scaleHPct + '%' : res.scaleWPct + '%');
      if (res.cropped) html += '<br>자를 영역 ' + fmtSize(res.crop.w, res.crop.h);
      var notes = res.errors.concat(res.warnings);
      if (notes.length) html += '<br><span class="sc-warn">⚠ ' + escapeHtml(notes.join(' ')) + '</span>';
      el.plan.innerHTML = html;
    }

    function syncLinked() {
      if (!state.img || !el.keep.checked) return;
      var res = calculate(readInput());
      if (!res.out) return;
      if (state.driver === 'w' && parseNum(el.w.value) >= 1) el.h.value = comma(res.out.h);
      if (state.driver === 'h' && parseNum(el.h.value) >= 1) el.w.value = comma(res.out.w);
    }

    function formatField(input) {
      var digits = input.value.replace(/[^\d]/g, '').slice(0, 5);
      input.value = digits ? comma(parseInt(digits, 10)) : '';
    }

    function clearActivePreset() {
      for (var k = 0; k < presetBtns.length; k++) presetBtns[k].className = presetBtns[k].className.replace(/\s?is-active/g, '');
    }

    function hideResult() {
      if (el.result) { el.result.style.display = 'none'; el.result.innerHTML = ''; }
      if (state.outUrl && window.URL) { URL.revokeObjectURL(state.outUrl); state.outUrl = null; }
    }

    function loadFile(file) {
      showMsg('');
      hideResult();
      if (!file) return;
      var looksImage = /^image\//.test(file.type || '') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name || '');
      if (!looksImage) { showMsg('이미지 파일만 선택할 수 있습니다.', true); return; }
      if (file.size > CONFIG.MAX_FILE_MB * 1048576) {
        showMsg('원본 용량이 ' + CONFIG.MAX_FILE_MB + 'MB를 넘어 불러올 수 없습니다.', true);
        return;
      }
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { showMsg('사진 크기를 읽지 못했습니다. 다른 사진으로 시도해 주세요.', true); return; }
        state.img = { el: img, w: w, h: h };
        state.file = file;
        el.info.innerHTML = '선택한 사진: <strong>' + fmtSize(w, h) + '</strong> · ' + formatBytes(file.size) +
          '<br><span class="sc-filename">' + escapeHtml(file.name || '') + '</span>';
        syncLinked();
        updatePlan();
      };
      img.onerror = function () {
        state.img = null;
        showMsg('이 사진 형식은 현재 브라우저에서 열 수 없습니다. JPG나 PNG로 바꾼 뒤 다시 시도해 주세요.', true);
      };
      if (state.srcUrl && window.URL) URL.revokeObjectURL(state.srcUrl);
      if (window.URL && URL.createObjectURL) {
        state.srcUrl = URL.createObjectURL(file);
        img.src = state.srcUrl;
      } else if (window.FileReader) {
        var reader = new FileReader();
        reader.onload = function (e) { img.src = e.target.result; };
        reader.readAsDataURL(file);
      }
    }

    function applyPreset(key, btn) {
      var p = CONFIG.PRESETS[key];
      if (!p) return;
      el.ratio.value = p.ratio;
      el.w.value = p.w ? comma(p.w) : '';
      el.h.value = p.h ? comma(p.h) : '';
      el.keep.checked = true;
      state.driver = 'w';
      if (p.format) el.format.value = p.format;
      if (p.quality) { el.quality.value = p.quality; if (el.qval) el.qval.textContent = p.quality + '%'; }
      el.quality.disabled = el.format.value === 'image/png';
      clearActivePreset();
      if (btn) btn.className += ' is-active';
      syncLinked();
      updatePlan();
      showMsg(p.label + ' 설정을 적용했습니다.' + (p.note ? ' ' + p.note : ''), false);
    }

    function finish() {
      state.busy = false;
      el.run.disabled = false;
      el.run.textContent = '✂️ 크기 변환하기';
    }

    function renderResult(res, blob, quality, notes) {
      var realType = blob.type || el.format.value;
      if (state.outUrl && window.URL) URL.revokeObjectURL(state.outUrl);
      state.outUrl = URL.createObjectURL(blob);
      var name = makeFileName(state.file ? state.file.name : 'photo', res.out.w, res.out.h, realType);
      var orig = state.file ? state.file.size : 0;
      var change = '';
      if (orig > 0) {
        var pct = round1((1 - blob.size / orig) * 100);
        change = pct >= 0 ? '원본 대비 ' + pct + '% 감소' : '원본 대비 ' + Math.abs(pct) + '% 증가';
      }
      var scaleText = res.stretched ? '가로 ' + res.scaleWPct + '% · 세로 ' + res.scaleHPct + '%' : res.scaleWPct + '%';
      var fmtLabel = CONFIG.FORMAT_LABELS[realType] || realType;
      var rows = [
        ['원본 크기', fmtSize(res.src.w, res.src.h) + (orig ? ' · ' + formatBytes(orig) : '')],
        ['자른 영역', res.cropped ? fmtSize(res.crop.w, res.crop.h) + ' (' + escapeHtml(res.ratioLabel) + ')' : '자르지 않음'],
        ['최종 크기', '<strong>' + fmtSize(res.out.w, res.out.h) + '</strong>'],
        ['배율', scaleText],
        ['형식·화질', fmtLabel + (realType === 'image/png' ? ' (무손실)' : ' · 화질 ' + quality + '%')],
        ['파일 용량', '<strong>' + formatBytes(blob.size) + '</strong>' + (change ? ' (' + change + ')' : '')]
      ];
      var tr = '';
      for (var r = 0; r < rows.length; r++) tr += '<tr><th scope="row">' + rows[r][0] + '</th><td>' + rows[r][1] + '</td></tr>';

      var html =
        '<div class="sc-total"><span>최종 결과</span><strong>' + fmtSize(res.out.w, res.out.h) + ' · ' + formatBytes(blob.size) + '</strong></div>' +
        '<div class="sc-preview"><img src="' + state.outUrl + '" alt="크기 조절된 사진 미리보기" width="' + res.out.w + '" height="' + res.out.h + '"></div>' +
        '<div class="sc-table-wrap"><table class="sc-table"><tbody>' + tr + '</tbody></table></div>' +
        '<p class="sc-basis">📐 계산 근거: ' + escapeHtml(res.basis) + '</p>';
      if (notes.length) html += '<p class="sc-warn">⚠ ' + escapeHtml(notes.join(' ')) + '</p>';
      html +=
        '<a class="sc-btn sc-download" href="' + state.outUrl + '" download="' + escapeHtml(name) + '">⬇ 사진 저장하기</a>' +
        '<p class="sc-tip">저장 파일명: ' + escapeHtml(name) + '<br>휴대폰에서 저장이 되지 않으면 미리보기 사진을 길게 눌러 저장해 주세요.</p>';

      el.result.innerHTML = html;
      el.result.style.display = '';
      if (el.result.scrollIntoView) el.result.scrollIntoView(true);
    }

    function run() {
      if (state.busy) return;
      showMsg('');
      if (!state.img) { showMsg('먼저 사진을 선택해 주세요.', true); return; }
      var res = calculate(readInput());
      if (!res.ok) { showMsg(res.errors.join(' '), true); return; }

      var type = el.format.value;
      var notes = res.warnings.slice();
      if (type === 'image/webp' && !supportsType('image/webp')) {
        type = 'image/jpeg';
        notes.push('이 브라우저는 WebP 저장을 지원하지 않아 JPG로 저장했습니다.');
      }
      var q = parseInt(el.quality.value, 10);
      if (!(q >= 10 && q <= 100)) q = CONFIG.DEFAULT_QUALITY;

      state.busy = true;
      el.run.disabled = true;
      el.run.textContent = '변환 중…';

      window.setTimeout(function () {
        var canvas;
        try {
          canvas = drawResized(state.img.el, res.crop, res.out, type === 'image/jpeg');
        } catch (e) {
          finish();
          showMsg('사진을 처리하지 못했습니다. 최종 크기를 줄여 다시 시도해 주세요.', true);
          return;
        }
        canvasToBlob(canvas, type, q / 100, function (blob) {
          finish();
          if (!blob) { showMsg('사진 파일을 만들지 못했습니다. 다른 저장 형식으로 시도해 주세요.', true); return; }
          renderResult(res, blob, q, notes);
        });
      }, 30);
    }

    function reset() {
      hideResult();
      if (state.srcUrl && window.URL) URL.revokeObjectURL(state.srcUrl);
      state.img = null; state.file = null; state.srcUrl = null; state.driver = 'w';
      el.file.value = '';
      el.ratio.value = 'original';
      if (el.anchor) el.anchor.value = '0.5';
      el.w.value = ''; el.h.value = '';
      el.keep.checked = true;
      el.format.value = CONFIG.DEFAULT_FORMAT;
      el.quality.value = CONFIG.DEFAULT_QUALITY;
      el.quality.disabled = false;
      if (el.qval) el.qval.textContent = CONFIG.DEFAULT_QUALITY + '%';
      el.info.textContent = '아직 선택한 사진이 없습니다.';
      clearActivePreset();
      showMsg('');
      updatePlan();
    }

    /* 이벤트 연결 */
    on(el.file, 'change', function () { loadFile(el.file.files && el.file.files[0]); });
    on(el.drop, 'dragover', function (e) { e.preventDefault(); el.drop.className += ' is-over'; });
    on(el.drop, 'dragleave', function () { el.drop.className = el.drop.className.replace(/\s?is-over/g, ''); });
    on(el.drop, 'drop', function (e) {
      e.preventDefault();
      el.drop.className = el.drop.className.replace(/\s?is-over/g, '');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    on(el.w, 'input', function () { formatField(el.w); state.driver = 'w'; clearActivePreset(); syncLinked(); updatePlan(); });
    on(el.h, 'input', function () { formatField(el.h); state.driver = 'h'; clearActivePreset(); syncLinked(); updatePlan(); });
    on(el.keep, 'change', function () { syncLinked(); updatePlan(); });
    on(el.ratio, 'change', function () { clearActivePreset(); syncLinked(); updatePlan(); });
    on(el.anchor, 'change', updatePlan);
    on(el.format, 'change', function () { el.quality.disabled = el.format.value === 'image/png'; });
    on(el.quality, 'input', function () { if (el.qval) el.qval.textContent = el.quality.value + '%'; });
    on(el.run, 'click', run);
    on(el.reset, 'click', reset);
    for (var p = 0; p < presetBtns.length; p++) {
      (function (btn) {
        on(btn, 'click', function () { applyPreset(btn.getAttribute('data-preset'), btn); });
      })(presetBtns[p]);
    }

    /* 화면 표시 */
    if (el.loading) el.loading.style.display = 'none';
    el.body.style.display = '';
    el.quality.value = CONFIG.DEFAULT_QUALITY;
    if (el.qval) el.qval.textContent = CONFIG.DEFAULT_QUALITY + '%';
    updatePlan();

    var api = { run: run, reset: reset, applyPreset: applyPreset };
    root.setAttribute('data-sc-ready', '1');
    root.salimApi = api;
    return api;
  }

  SalimCalc.imageResize = {
    version: CONFIG.VERSION,
    CONFIG: CONFIG,
    init: init,
    calculate: calculate,
    cmToPx: cmToPx,
    formatBytes: formatBytes
  };
})(window, document);