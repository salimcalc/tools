/*!
 * 모듈명   : SalimCalc.PhotoCompress — 사진 용량 줄이기(이미지 압축) 도구
 * 용도     : JPG·WebP 변환, 품질 조절, 가로 크기 축소, 목표 용량 자동 맞춤,
 *            압축 전후 화질 비교, 여러 장 일괄 압축
 * 기준     : HTML Living Standard — HTMLCanvasElement.toBlob / toDataURL(image/jpeg, image/webp)
 *            WebP 인코딩 가능 여부는 실행 시점에 브라우저에서 자동 감지
 *            iOS Safari 캔버스 픽셀 상한(약 1,670만 화소) 자동 보정
 * 기준일   : 2026-10-05
 * 버전     : 1.0.0
 * 최종수정 : 2026-10-05
 * 비고     : 모든 변환은 사용자 기기에서만 실행되며, 어떤 파일도 외부 서버로 전송되지 않습니다.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* ------------------------------------------------------------------
   * CONFIG — 기준값은 모두 여기서만 수정합니다.
   * ------------------------------------------------------------------ */
  var CONFIG = {
    MAX_FILES: 20,                  // 한 번에 처리할 최대 장수
    MAX_FILE_BYTES: 30 * 1024 * 1024, // 파일 1장 최대 용량(30MB)
    MAX_CANVAS_PIXELS: 16700000,    // 모바일 캔버스 픽셀 상한(약 1,670만 화소)
    MIN_TARGET_KB: 5,               // 목표 용량 최소값
    MAX_TARGET_KB: 20480,           // 목표 용량 최대값(20MB)
    DEFAULT_QUALITY: 80,            // 기본 품질(%)
    QUALITY_MIN: 30,
    QUALITY_MAX: 95,
    SEARCH_QUALITY_MIN: 0.25,       // 목표 용량 모드에서 탐색할 품질 하한
    SEARCH_QUALITY_MAX: 0.95,       // 목표 용량 모드에서 탐색할 품질 상한
    SEARCH_STEPS: 6,                // 품질 이분탐색 횟수
    SCALE_LADDER: [1, 0.8, 0.64, 0.5, 0.38, 0.28], // 품질만으로 부족할 때 줄여 볼 배율
    SUFFIX: '_min',                 // 저장 파일명 꼬리말
    DOWNLOAD_GAP_MS: 450,           // 일괄 저장 간격
    MIME: { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' },
    EXT: { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }
  };

  var SalimCalc = global.SalimCalc = global.SalimCalc || {};

  /* ------------------------------------------------------------------
   * 1. 순수 함수 — DOM에 의존하지 않으며 단독 테스트가 가능합니다.
   * ------------------------------------------------------------------ */

  function toNumber(value) {
    if (typeof value === 'number') { return value; }
    if (value === null || value === undefined) { return NaN; }
    var cleaned = String(value).replace(/[,\s]/g, '');
    if (cleaned === '') { return NaN; }
    return parseFloat(cleaned);
  }

  function clamp(n, min, max) {
    if (n < min) { return min; }
    if (n > max) { return max; }
    return n;
  }

  function formatInt(n) {
    var num = Math.round(toNumber(n));
    if (!isFinite(num)) { return '0'; }
    var sign = num < 0 ? '-' : '';
    var digits = String(Math.abs(num));
    return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatBytes(bytes) {
    var n = toNumber(bytes);
    if (!isFinite(n) || n < 0) { return '-'; }
    if (n < 1024) { return formatInt(n) + ' B'; }
    var kb = n / 1024;
    if (kb < 1024) { return (kb < 10 ? kb.toFixed(1) : formatInt(kb)) + ' KB'; }
    var mb = kb / 1024;
    return mb.toFixed(mb < 10 ? 2 : 1) + ' MB';
  }

  /** 목표 용량 입력값 → 바이트. 검증 결과를 함께 돌려줍니다. */
  function parseTargetBytes(raw, unit) {
    var text = raw === null || raw === undefined ? '' : String(raw).replace(/[,\s]/g, '');
    if (text === '') {
      return { ok: false, bytes: 0, error: '목표 용량을 입력해 주세요.' };
    }
    var n = toNumber(text);
    if (!isFinite(n) || n <= 0) {
      return { ok: false, bytes: 0, error: '목표 용량은 0보다 큰 숫자로 입력해 주세요.' };
    }
    var kb = unit === 'MB' ? n * 1024 : n;
    if (kb < CONFIG.MIN_TARGET_KB) {
      return { ok: false, bytes: 0, error: '목표 용량은 ' + CONFIG.MIN_TARGET_KB + 'KB 이상이어야 합니다.' };
    }
    if (kb > CONFIG.MAX_TARGET_KB) {
      return { ok: false, bytes: 0, error: '목표 용량은 ' + (CONFIG.MAX_TARGET_KB / 1024) + 'MB 이하로 입력해 주세요.' };
    }
    return { ok: true, bytes: Math.round(kb * 1024), kb: kb, error: '' };
  }

  /** 긴 변 제한과 캔버스 픽셀 상한을 적용한 출력 크기 계산 */
  function planResize(width, height, maxEdge, maxPixels) {
    var w = Math.max(1, Math.round(toNumber(width) || 1));
    var h = Math.max(1, Math.round(toNumber(height) || 1));
    var limit = Math.round(toNumber(maxEdge) || 0);
    var cap = Math.round(toNumber(maxPixels) || 0);
    var outW = w, outH = h, changed = false, reason = '';

    if (limit > 0 && Math.max(w, h) > limit) {
      var r = limit / Math.max(w, h);
      outW = Math.max(1, Math.round(w * r));
      outH = Math.max(1, Math.round(h * r));
      changed = true;
      reason = 'maxEdge';
    }
    if (cap > 0 && outW * outH > cap) {
      var r2 = Math.sqrt(cap / (outW * outH));
      outW = Math.max(1, Math.floor(outW * r2));
      outH = Math.max(1, Math.floor(outH * r2));
      changed = true;
      reason = reason ? reason + '+pixelCap' : 'pixelCap';
    }
    return { width: outW, height: outH, changed: changed, reason: reason };
  }

  /** 원본 형식과 선택값으로 출력 형식 결정 */
  function pickOutputType(fileType, format, webpSupported) {
    var src = String(fileType || '').toLowerCase();
    var want = String(format || 'jpeg').toLowerCase();

    if (want === 'auto') {
      if (src === CONFIG.MIME.png) { want = 'png'; }
      else if (src === CONFIG.MIME.webp) { want = 'webp'; }
      else { want = 'jpeg'; }
    }
    if (want === 'webp' && webpSupported === false) { want = 'jpeg'; }
    if (want !== 'jpeg' && want !== 'webp' && want !== 'png') { want = 'jpeg'; }

    var mime = CONFIG.MIME[want];
    return {
      key: want,
      mime: mime,
      ext: CONFIG.EXT[mime],
      lossless: want === 'png',
      label: want === 'jpeg' ? 'JPG' : (want === 'webp' ? 'WebP' : 'PNG')
    };
  }

  /**
   * 압축 결과 계산(순수 함수)
   * input: { originalBytes, resultBytes, targetBytes, quality(0~1), width, height,
   *          originalWidth, originalHeight, formatLabel }
   */
  function calculate(input) {
    var src = input || {};
    var originalBytes = Math.round(toNumber(src.originalBytes));
    var resultBytes = Math.round(toNumber(src.resultBytes));
    var targetBytes = src.targetBytes ? Math.round(toNumber(src.targetBytes)) : 0;

    if (!isFinite(originalBytes) || originalBytes <= 0) {
      return { ok: false, error: '원본 용량을 확인할 수 없습니다.' };
    }
    if (!isFinite(resultBytes) || resultBytes <= 0) {
      return { ok: false, error: '압축 결과 용량을 확인할 수 없습니다.' };
    }

    var savedBytes = originalBytes - resultBytes;
    var savedPercent = Math.round((savedBytes / originalBytes) * 1000) / 10;
    var ratioPercent = Math.round((resultBytes / originalBytes) * 1000) / 10;
    var grew = savedBytes <= 0;

    var hasTarget = targetBytes > 0;
    var targetMet = hasTarget ? resultBytes <= targetBytes : null;
    var gapBytes = hasTarget ? resultBytes - targetBytes : 0;

    var qualityPercent = null;
    if (src.quality !== null && src.quality !== undefined && isFinite(toNumber(src.quality))) {
      qualityPercent = Math.round(toNumber(src.quality) * 100);
    }

    var verdict;
    if (hasTarget) {
      verdict = targetMet ? '목표 달성' : '목표 미달';
    } else {
      verdict = grew ? '원본이 더 작음' : '압축 완료';
    }

    var parts = [];
    parts.push((src.formatLabel || 'JPG') + ' 변환');
    if (qualityPercent !== null) { parts.push('품질 ' + qualityPercent + '%'); }
    else { parts.push('무손실(품질값 미적용)'); }
    if (src.width && src.originalWidth && Number(src.width) !== Number(src.originalWidth)) {
      parts.push(src.originalWidth + '×' + src.originalHeight + ' → ' + src.width + '×' + src.height + 'px 축소');
    } else if (src.width) {
      parts.push(src.width + '×' + src.height + 'px 유지');
    }

    return {
      ok: true,
      originalBytes: originalBytes,
      resultBytes: resultBytes,
      savedBytes: savedBytes,
      savedPercent: savedPercent,
      ratioPercent: ratioPercent,
      grew: grew,
      hasTarget: hasTarget,
      targetBytes: targetBytes,
      targetMet: targetMet,
      gapBytes: gapBytes,
      qualityPercent: qualityPercent,
      width: src.width || null,
      height: src.height || null,
      verdict: verdict,
      basis: parts.join(' · '),
      originalText: formatBytes(originalBytes),
      resultText: formatBytes(resultBytes),
      savedText: (grew ? '+' : '-') + formatBytes(Math.abs(savedBytes))
    };
  }

  /** 여러 장 결과 합산(순수 함수) */
  function summarize(rows) {
    var list = rows || [];
    var totalOriginal = 0, totalResult = 0, done = 0, met = 0, targetCount = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || !r.ok) { continue; }
      done++;
      totalOriginal += r.originalBytes;
      totalResult += r.resultBytes;
      if (r.hasTarget) {
        targetCount++;
        if (r.targetMet) { met++; }
      }
    }
    var savedBytes = totalOriginal - totalResult;
    var savedPercent = totalOriginal > 0 ? Math.round((savedBytes / totalOriginal) * 1000) / 10 : 0;
    return {
      count: done,
      totalOriginal: totalOriginal,
      totalResult: totalResult,
      savedBytes: savedBytes,
      savedPercent: savedPercent,
      targetCount: targetCount,
      targetMet: met
    };
  }

  function baseName(name) {
    var text = String(name || 'image');
    var dot = text.lastIndexOf('.');
    return dot > 0 ? text.slice(0, dot) : text;
  }

  function outputFileName(name, ext) {
    return baseName(name) + CONFIG.SUFFIX + '.' + ext;
  }

  /* ------------------------------------------------------------------
   * 2. 브라우저 기능 감지 / 인코딩
   * ------------------------------------------------------------------ */

  function supportsEncode(mime) {
    try {
      var c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      return c.toDataURL(mime).indexOf('data:' + mime) === 0;
    } catch (e) {
      return false;
    }
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [null, 'image/jpeg'])[1];
    var binary = global.atob(parts[1]);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) { bytes[i] = binary.charCodeAt(i); }
    return new Blob([bytes], { type: mime });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (blob) { resolve(blob); } else { reject(new Error('이미지를 변환하지 못했습니다.')); }
        }, mime, quality);
        return;
      }
      try {
        resolve(dataUrlToBlob(canvas.toDataURL(mime, quality)));
      } catch (err) {
        reject(err);
      }
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = global.URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) {
          global.URL.revokeObjectURL(url);
          reject(new Error('이미지 크기를 읽을 수 없습니다.'));
          return;
        }
        resolve({ img: img, url: url, width: w, height: h });
      };
      img.onerror = function () {
        global.URL.revokeObjectURL(url);
        reject(new Error('이미지를 읽을 수 없는 형식입니다.'));
      };
      img.src = url;
    });
  }

  function drawTo(source, width, height, flattenMime) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) { ctx.imageSmoothingQuality = 'high'; }
    if (flattenMime === CONFIG.MIME.jpeg) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  /** 크게 줄일 때는 단계적으로 축소해 계단 현상을 줄입니다. */
  function makeCanvas(img, srcW, srcH, dstW, dstH, mime) {
    var source = img;
    var curW = srcW;
    var curH = srcH;
    var guard = 0;
    while (curW >= dstW * 2 && curH >= dstH * 2 && guard < 6) {
      curW = Math.max(dstW, Math.round(curW / 2));
      curH = Math.max(dstH, Math.round(curH / 2));
      source = drawTo(source, curW, curH, null);
      guard++;
    }
    return drawTo(source, dstW, dstH, mime);
  }

  /** 목표 용량 이하가 되는 가장 높은 품질을 이분탐색 */
  function searchQuality(canvas, mime, targetBytes, lossless) {
    if (lossless) {
      return canvasToBlob(canvas, mime).then(function (blob) {
        return { blob: blob, quality: null, met: blob.size <= targetBytes };
      });
    }
    var lo = CONFIG.SEARCH_QUALITY_MIN;
    var hi = CONFIG.SEARCH_QUALITY_MAX;
    var bestFit = null;
    var smallest = null;
    var step = 0;

    function run() {
      if (step >= CONFIG.SEARCH_STEPS) {
        return Promise.resolve(bestFit || smallest);
      }
      step++;
      var q = Math.round(((lo + hi) / 2) * 100) / 100;
      return canvasToBlob(canvas, mime, q).then(function (blob) {
        if (!smallest || blob.size < smallest.blob.size) {
          smallest = { blob: blob, quality: q, met: blob.size <= targetBytes };
        }
        if (blob.size <= targetBytes) {
          if (!bestFit || blob.size > bestFit.blob.size) {
            bestFit = { blob: blob, quality: q, met: true };
          }
          lo = q;
        } else {
          hi = q;
        }
        return run();
      });
    }
    return run();
  }

  /** 품질로 안 되면 배율을 단계적으로 낮춰 목표 용량을 맞춥니다. */
  function fitToTarget(img, srcW, srcH, baseW, baseH, mime, targetBytes, lossless) {
    var ladder = CONFIG.SCALE_LADDER;
    var index = 0;
    var fallback = null;

    function tryScale() {
      if (index >= ladder.length) { return Promise.resolve(fallback); }
      var scale = ladder[index++];
      var w = Math.max(1, Math.round(baseW * scale));
      var h = Math.max(1, Math.round(baseH * scale));
      var canvas = makeCanvas(img, srcW, srcH, w, h, mime);
      return searchQuality(canvas, mime, targetBytes, lossless).then(function (found) {
        if (!found) { return tryScale(); }
        found.width = w;
        found.height = h;
        found.scale = scale;
        if (found.met) { return found; }
        if (!fallback || found.blob.size < fallback.blob.size) { fallback = found; }
        return tryScale();
      });
    }
    return tryScale();
  }

  /* ------------------------------------------------------------------
   * 3. UI 바인딩
   * ------------------------------------------------------------------ */

  function init(selector) {
    var root = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!root || root.getAttribute('data-sc-ready') === '1') { return; }
    if (typeof Promise === 'undefined' || !global.URL || !global.URL.createObjectURL) {
      var warn = root.querySelector('[data-sc="fallback"]');
      if (warn) { warn.textContent = '이 브라우저에서는 사진 압축 기능을 사용할 수 없습니다. 최신 크롬·사파리·엣지에서 다시 열어 주세요.'; }
      return;
    }

    var pick = function (key) { return root.querySelector('[data-sc="' + key + '"]'); };
    var el = {
      file: pick('file'),
      drop: pick('drop'),
      pickCount: pick('pick-count'),
      format: pick('format'),
      quality: pick('quality'),
      qualityOut: pick('quality-out'),
      qualityWrap: pick('quality-wrap'),
      maxedge: pick('maxedge'),
      target: pick('target'),
      targetUnit: pick('target-unit'),
      targetWrap: pick('target-wrap'),
      run: pick('run'),
      reset: pick('reset'),
      msg: pick('msg'),
      progress: pick('progress'),
      progressBar: pick('progress-bar'),
      progressText: pick('progress-text'),
      summary: pick('summary'),
      resultsWrap: pick('results-wrap'),
      results: pick('results'),
      compare: pick('compare'),
      downloadAll: pick('download-all'),
      note: pick('note')
    };

    if (!el.file || !el.run || !el.results) {
      if (el.msg) { el.msg.textContent = '계산기 화면을 불러오지 못했습니다. 페이지를 새로 고쳐 주세요.'; }
      return;
    }

    var webpOK = supportsEncode(CONFIG.MIME.webp);
    if (!webpOK && el.format) {
      var opts = el.format.options;
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === 'webp') {
          opts[i].disabled = true;
          opts[i].text = 'WebP (이 브라우저 미지원)';
        }
      }
      if (el.format.value === 'webp') { el.format.value = 'jpeg'; }
    }

    var state = { items: [], busy: false, compareId: null };

    /* ---- 공통 표시 ---- */
    function setMsg(text, kind) {
      if (!el.msg) { return; }
      el.msg.textContent = text || '';
      el.msg.className = 'salim-sc-msg' + (text ? ' is-show' : '') + (kind ? ' is-' + kind : '');
    }

    function setProgress(done, total, label) {
      if (!el.progress) { return; }
      if (total <= 0) {
        el.progress.className = 'salim-sc-progress';
        return;
      }
      el.progress.className = 'salim-sc-progress is-show';
      var pct = Math.round((done / total) * 100);
      if (el.progressBar) { el.progressBar.style.width = pct + '%'; }
      if (el.progressText) { el.progressText.textContent = label || (done + ' / ' + total + ' 장 완료'); }
    }

    function currentMode() {
      var checked = root.querySelector('input[name="salim-sc-mode"]:checked');
      return checked ? checked.value : 'quality';
    }

    function syncMode() {
      var mode = currentMode();
      if (el.targetWrap) { el.targetWrap.className = 'salim-sc-field' + (mode === 'target' ? ' is-show' : ''); }
      if (el.qualityWrap) { el.qualityWrap.className = 'salim-sc-field' + (mode === 'quality' ? ' is-show' : ''); }
    }

    function clearItems() {
      for (var i = 0; i < state.items.length; i++) {
        var it = state.items[i];
        if (it.originalUrl) { global.URL.revokeObjectURL(it.originalUrl); }
        if (it.resultUrl) { global.URL.revokeObjectURL(it.resultUrl); }
      }
      state.items = [];
      state.compareId = null;
    }

    /* ---- 파일 선택 ---- */
    function acceptFiles(fileList) {
      var files = [];
      var skipped = [];
      for (var i = 0; i < fileList.length; i++) {
        var f = fileList[i];
        if (!f || String(f.type).indexOf('image/') !== 0) { skipped.push(f && f.name ? f.name : '알 수 없는 파일'); continue; }
        if (f.size > CONFIG.MAX_FILE_BYTES) { skipped.push(f.name + '(용량 초과)'); continue; }
        files.push(f);
        if (files.length >= CONFIG.MAX_FILES) { break; }
      }
      if (!files.length) {
        setMsg('이미지 파일을 선택해 주세요. (최대 ' + formatBytes(CONFIG.MAX_FILE_BYTES) + ', ' + CONFIG.MAX_FILES + '장)', 'warn');
        return;
      }
      clearItems();
      if (el.results) { el.results.innerHTML = ''; }
      if (el.compare) { el.compare.innerHTML = ''; el.compare.className = 'salim-sc-compare'; }
      if (el.summary) { el.summary.className = 'salim-sc-summary'; el.summary.innerHTML = ''; }
      if (el.resultsWrap) { el.resultsWrap.className = 'salim-sc-results'; }

      for (var k = 0; k < files.length; k++) {
        state.items.push({ id: 'sc' + k + '-' + Date.now(), file: files[k], name: files[k].name, originalBytes: files[k].size });
      }
      if (el.pickCount) {
        el.pickCount.textContent = '선택한 사진 ' + state.items.length + '장 · 합계 ' + formatBytes(summarizeInput());
      }
      var note = skipped.length ? ' (제외: ' + skipped.length + '건)' : '';
      setMsg('사진 ' + state.items.length + '장을 불러왔습니다.' + note + ' 설정을 고른 뒤 「용량 줄이기」를 눌러 주세요.', 'ok');
    }

    function summarizeInput() {
      var total = 0;
      for (var i = 0; i < state.items.length; i++) { total += state.items[i].originalBytes; }
      return total;
    }

    /* ---- 결과 카드 ---- */
    function makeEl(tag, cls, text) {
      var node = document.createElement(tag);
      if (cls) { node.className = cls; }
      if (text !== undefined && text !== null) { node.textContent = text; }
      return node;
    }

    function line(label, value, valueCls) {
      var wrap = makeEl('div', 'salim-sc-line');
      wrap.appendChild(makeEl('span', 'salim-sc-key', label));
      wrap.appendChild(makeEl('b', 'salim-sc-val' + (valueCls ? ' ' + valueCls : ''), value));
      return wrap;
    }

    function renderItem(item) {
      var card = makeEl('div', 'salim-sc-item');
      card.setAttribute('data-id', item.id);

      var head = makeEl('div', 'salim-sc-item-head');
      head.appendChild(makeEl('span', 'salim-sc-name', item.name));
      var r = item.result;
      if (r && r.ok) {
        var badgeCls = 'salim-sc-badge';
        if (r.hasTarget) { badgeCls += r.targetMet ? ' is-ok' : ' is-no'; }
        else if (r.grew) { badgeCls += ' is-no'; }
        else { badgeCls += ' is-ok'; }
        head.appendChild(makeEl('span', badgeCls, r.verdict));
      } else if (item.error) {
        head.appendChild(makeEl('span', 'salim-sc-badge is-no', '실패'));
      } else {
        head.appendChild(makeEl('span', 'salim-sc-badge', '대기'));
      }
      card.appendChild(head);

      var body = makeEl('div', 'salim-sc-item-body');
      if (r && r.ok) {
        body.appendChild(line('원본', r.originalText + ' · ' + item.originalWidth + '×' + item.originalHeight));
        body.appendChild(line('압축 후', r.resultText + ' · ' + r.width + '×' + r.height));
        body.appendChild(line('절감', r.grew
          ? '줄지 않음 (' + r.ratioPercent + '%)'
          : r.savedPercent + '% 감소 (' + formatBytes(r.savedBytes) + ' 절약)', r.grew ? 'is-warn' : 'is-save'));
        if (r.hasTarget) {
          body.appendChild(line('목표', formatBytes(r.targetBytes) + (r.targetMet
            ? ' 이하 달성'
            : ' 초과 (' + formatBytes(r.gapBytes) + ' 남음)'), r.targetMet ? 'is-save' : 'is-warn'));
        }
        body.appendChild(makeEl('p', 'salim-sc-basis', '계산 근거 · ' + r.basis));
      } else if (item.error) {
        body.appendChild(makeEl('p', 'salim-sc-basis', item.error));
      } else {
        body.appendChild(makeEl('p', 'salim-sc-basis', '원본 ' + formatBytes(item.originalBytes) + ' · 처리 대기 중'));
      }
      card.appendChild(body);

      if (r && r.ok) {
        var act = makeEl('div', 'salim-sc-item-act');
        var dl = makeEl('button', 'salim-sc-btn is-ghost', '저장하기');
        dl.type = 'button';
        dl.setAttribute('data-act', 'download');
        var cmp = makeEl('button', 'salim-sc-btn is-ghost', '전후 화질 비교');
        cmp.type = 'button';
        cmp.setAttribute('data-act', 'compare');
        act.appendChild(dl);
        act.appendChild(cmp);
        card.appendChild(act);
      }
      return card;
    }

    function refreshItem(item) {
      var old = el.results.querySelector('[data-id="' + item.id + '"]');
      var fresh = renderItem(item);
      if (old) { el.results.replaceChild(fresh, old); } else { el.results.appendChild(fresh); }
    }

    function renderAll() {
      el.results.innerHTML = '';
      for (var i = 0; i < state.items.length; i++) {
        el.results.appendChild(renderItem(state.items[i]));
      }
      if (el.resultsWrap) { el.resultsWrap.className = 'salim-sc-results is-show'; }
    }

    function renderSummary() {
      if (!el.summary) { return; }
      var rows = [];
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].result) { rows.push(state.items[i].result); }
      }
      var s = summarize(rows);
      if (!s.count) { el.summary.className = 'salim-sc-summary'; el.summary.innerHTML = ''; return; }
      el.summary.innerHTML = '';
      el.summary.className = 'salim-sc-summary is-show';
      el.summary.appendChild(makeEl('div', 'salim-sc-sum-title', '총 ' + s.count + '장 처리 결과'));
      var grid = makeEl('div', 'salim-sc-sum-grid');
      grid.appendChild(line('원본 합계', formatBytes(s.totalOriginal)));
      grid.appendChild(line('압축 후 합계', formatBytes(s.totalResult)));
      if (s.targetCount) {
        grid.appendChild(line('목표 달성', s.targetMet + ' / ' + s.targetCount + '장', s.targetMet === s.targetCount ? 'is-save' : 'is-warn'));
      }
      el.summary.appendChild(grid);
      var total = makeEl('div', 'salim-sc-total');
      total.appendChild(makeEl('span', null, '총 절감 용량'));
      total.appendChild(makeEl('strong', null, formatBytes(Math.max(0, s.savedBytes)) + ' (' + s.savedPercent + '%)'));
      el.summary.appendChild(total);
    }

    /* ---- 전후 비교 ---- */
    function openCompare(item) {
      if (!el.compare || !item.result || !item.result.ok) { return; }
      state.compareId = item.id;
      el.compare.innerHTML = '';
      el.compare.className = 'salim-sc-compare is-show';

      var head = makeEl('div', 'salim-sc-cmp-head');
      head.appendChild(makeEl('strong', null, item.name));
      var close = makeEl('button', 'salim-sc-btn is-ghost is-sm', '닫기');
      close.type = 'button';
      close.setAttribute('data-act', 'close-compare');
      head.appendChild(close);
      el.compare.appendChild(head);

      var stage = makeEl('div', 'salim-sc-cmp-stage');
      var after = document.createElement('img');
      after.className = 'salim-sc-cmp-after';
      after.alt = '압축 후 사진 미리보기';
      after.src = item.resultUrl;
      var clip = makeEl('div', 'salim-sc-cmp-clip');
      var before = document.createElement('img');
      before.className = 'salim-sc-cmp-before';
      before.alt = '압축 전 원본 사진 미리보기';
      before.src = item.originalUrl;
      clip.appendChild(before);
      var handle = makeEl('div', 'salim-sc-cmp-handle');
      stage.appendChild(after);
      stage.appendChild(clip);
      stage.appendChild(handle);
      el.compare.appendChild(stage);

      var slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = '50';
      slider.className = 'salim-sc-cmp-range';
      slider.setAttribute('aria-label', '원본과 압축 후 비교 위치');
      el.compare.appendChild(slider);

      var legend = makeEl('div', 'salim-sc-cmp-legend');
      legend.appendChild(makeEl('span', null, '◀ 원본 ' + item.result.originalText));
      legend.appendChild(makeEl('span', null, '압축 후 ' + item.result.resultText + ' ▶'));
      el.compare.appendChild(legend);

      var zoomWrap = makeEl('label', 'salim-sc-cmp-zoom');
      var zoom = document.createElement('input');
      zoom.type = 'checkbox';
      zoomWrap.appendChild(zoom);
      zoomWrap.appendChild(document.createTextNode(' 실제 크기(100%)로 확대해 보기'));
      el.compare.appendChild(zoomWrap);
      el.compare.appendChild(makeEl('p', 'salim-sc-basis', '같은 배율로 겹쳐 보여 줍니다. 슬라이더를 움직여 경계선을 좌우로 옮겨 보세요.'));

      function layout() {
        var w = zoom.checked ? item.result.width : stage.clientWidth;
        if (!w) { w = stage.clientWidth || 320; }
        after.style.width = w + 'px';
        before.style.width = w + 'px';
        stage.className = 'salim-sc-cmp-stage' + (zoom.checked ? ' is-zoom' : '');
      }
      function move() {
        var pct = clamp(toNumber(slider.value) || 0, 0, 100);
        clip.style.width = pct + '%';
        handle.style.left = pct + '%';
      }
      slider.onchange = move;
      slider.oninput = move;
      zoom.onchange = function () { layout(); move(); };
      after.onload = function () { layout(); move(); };
      layout();
      move();

      if (el.compare.scrollIntoView) { el.compare.scrollIntoView({ block: 'nearest' }); }
    }

    function closeCompare() {
      if (!el.compare) { return; }
      el.compare.innerHTML = '';
      el.compare.className = 'salim-sc-compare';
      state.compareId = null;
    }

    /* ---- 저장 ---- */
    function downloadItem(item) {
      if (!item.resultUrl) { return; }
      var a = document.createElement('a');
      a.href = item.resultUrl;
      a.download = item.outName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function downloadAll() {
      var ready = [];
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].resultUrl) { ready.push(state.items[i]); }
      }
      if (!ready.length) { setMsg('저장할 결과가 없습니다.', 'warn'); return; }
      var idx = 0;
      (function step() {
        if (idx >= ready.length) {
          setMsg(ready.length + '장을 모두 저장했습니다. 저장이 막히면 사진을 하나씩 눌러 저장해 주세요.', 'ok');
          return;
        }
        downloadItem(ready[idx++]);
        global.setTimeout(step, CONFIG.DOWNLOAD_GAP_MS);
      })();
    }

    /* ---- 처리 ---- */
    function readOptions() {
      var mode = currentMode();
      var opts = {
        mode: mode,
        format: el.format ? el.format.value : 'jpeg',
        quality: el.quality ? clamp(Math.round(toNumber(el.quality.value) || CONFIG.DEFAULT_QUALITY), CONFIG.QUALITY_MIN, CONFIG.QUALITY_MAX) : CONFIG.DEFAULT_QUALITY,
        maxEdge: el.maxedge ? Math.round(toNumber(el.maxedge.value) || 0) : 0,
        targetBytes: 0
      };
      if (mode === 'target') {
        var parsed = parseTargetBytes(el.target ? el.target.value : '', el.targetUnit ? el.targetUnit.value : 'KB');
        if (!parsed.ok) { return { error: parsed.error }; }
        opts.targetBytes = parsed.bytes;
      }
      return opts;
    }

    function processItem(item, opts) {
      return loadImage(item.file).then(function (loaded) {
        item.originalUrl = loaded.url;
        item.originalWidth = loaded.width;
        item.originalHeight = loaded.height;

        var out = pickOutputType(item.file.type, opts.format, webpOK);
        var plan = planResize(loaded.width, loaded.height, opts.maxEdge, CONFIG.MAX_CANVAS_PIXELS);
        item.outName = outputFileName(item.name, out.ext);

        var task;
        if (opts.mode === 'target') {
          task = fitToTarget(loaded.img, loaded.width, loaded.height, plan.width, plan.height, out.mime, opts.targetBytes, out.lossless);
        } else {
          var canvas = makeCanvas(loaded.img, loaded.width, loaded.height, plan.width, plan.height, out.mime);
          task = canvasToBlob(canvas, out.mime, out.lossless ? undefined : opts.quality / 100).then(function (blob) {
            return { blob: blob, quality: out.lossless ? null : opts.quality / 100, width: plan.width, height: plan.height, met: null };
          });
        }

        return task.then(function (res) {
          if (!res || !res.blob) { throw new Error('변환 결과를 만들지 못했습니다.'); }
          if (item.resultUrl) { global.URL.revokeObjectURL(item.resultUrl); }
          item.blob = res.blob;
          item.resultUrl = global.URL.createObjectURL(res.blob);
          item.result = calculate({
            originalBytes: item.originalBytes,
            resultBytes: res.blob.size,
            targetBytes: opts.targetBytes,
            quality: res.quality,
            width: res.width,
            height: res.height,
            originalWidth: loaded.width,
            originalHeight: loaded.height,
            formatLabel: out.label
          });
          return item;
        });
      })['catch'](function (err) {
        item.error = (err && err.message) ? err.message : '처리 중 문제가 생겼습니다.';
        item.result = null;
        return item;
      });
    }

    function run() {
      if (state.busy) { return; }
      if (!state.items.length) {
        setMsg('먼저 사진을 선택해 주세요.', 'warn');
        return;
      }
      var opts = readOptions();
      if (opts.error) { setMsg(opts.error, 'warn'); if (el.target) { el.target.focus(); } return; }

      state.busy = true;
      el.run.disabled = true;
      closeCompare();
      setMsg('사진을 변환하고 있습니다. 장수가 많으면 조금 기다려 주세요.', 'ok');
      renderAll();
      setProgress(0, state.items.length, '0 / ' + state.items.length + ' 장 완료');

      var index = 0;
      function next() {
        if (index >= state.items.length) {
          state.busy = false;
          el.run.disabled = false;
          renderSummary();
          setProgress(state.items.length, state.items.length, '변환 완료');
          var failed = 0;
          for (var i = 0; i < state.items.length; i++) { if (state.items[i].error) { failed++; } }
          setMsg(failed
            ? (state.items.length - failed) + '장 변환 완료, ' + failed + '장 실패했습니다.'
            : '변환이 끝났습니다. 결과를 확인하고 저장해 주세요.', failed ? 'warn' : 'ok');
          return;
        }
        var item = state.items[index++];
        processItem(item, opts).then(function (done) {
          refreshItem(done);
          setProgress(index, state.items.length, index + ' / ' + state.items.length + ' 장 완료');
          global.setTimeout(next, 0);
        });
      }
      next();
    }

    function findItem(id) {
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].id === id) { return state.items[i]; }
      }
      return null;
    }

    /* ---- 이벤트 ---- */
    el.file.onchange = function () {
      if (el.file.files && el.file.files.length) { acceptFiles(el.file.files); }
    };

    if (el.drop) {
      el.drop.addEventListener('dragover', function (e) {
        e.preventDefault();
        el.drop.className = 'salim-sc-drop is-over';
      });
      el.drop.addEventListener('dragleave', function () {
        el.drop.className = 'salim-sc-drop';
      });
      el.drop.addEventListener('drop', function (e) {
        e.preventDefault();
        el.drop.className = 'salim-sc-drop';
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          acceptFiles(e.dataTransfer.files);
        }
      });
    }

    if (el.quality && el.qualityOut) {
      var syncQuality = function () {
        var q = clamp(Math.round(toNumber(el.quality.value) || CONFIG.DEFAULT_QUALITY), CONFIG.QUALITY_MIN, CONFIG.QUALITY_MAX);
        el.qualityOut.textContent = q + '%';
      };
      el.quality.oninput = syncQuality;
      el.quality.onchange = syncQuality;
      syncQuality();
    }

    if (el.target) {
      el.target.oninput = function () {
        var digits = el.target.value.replace(/[^\d]/g, '');
        el.target.value = digits ? formatInt(digits) : '';
      };
    }

    var modeInputs = root.querySelectorAll('input[name="salim-sc-mode"]');
    for (var m = 0; m < modeInputs.length; m++) {
      modeInputs[m].onchange = syncMode;
    }
    syncMode();

    el.run.onclick = run;

    if (el.reset) {
      el.reset.onclick = function () {
        clearItems();
        el.results.innerHTML = '';
        closeCompare();
        if (el.summary) { el.summary.className = 'salim-sc-summary'; el.summary.innerHTML = ''; }
        if (el.resultsWrap) { el.resultsWrap.className = 'salim-sc-results'; }
        if (el.pickCount) { el.pickCount.textContent = ''; }
        if (el.file) { el.file.value = ''; }
        setProgress(0, 0);
        setMsg('');
      };
    }

    if (el.downloadAll) { el.downloadAll.onclick = downloadAll; }

    el.results.addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== el.results && !node.getAttribute) { node = node.parentNode; }
      var act = null;
      while (node && node !== el.results) {
        act = node.getAttribute('data-act');
        if (act) { break; }
        node = node.parentNode;
      }
      if (!act) { return; }
      var card = node;
      while (card && card !== el.results && !card.getAttribute('data-id')) { card = card.parentNode; }
      var item = card && card.getAttribute ? findItem(card.getAttribute('data-id')) : null;
      if (!item) { return; }
      if (act === 'download') { downloadItem(item); }
      if (act === 'compare') { openCompare(item); }
    });

    if (el.compare) {
      el.compare.addEventListener('click', function (e) {
        var node = e.target;
        if (node && node.getAttribute && node.getAttribute('data-act') === 'close-compare') { closeCompare(); }
      });
    }

    if (el.note) {
      el.note.textContent = '이 도구는 사진을 서버로 보내지 않고 ' +
        (webpOK ? '기기 안에서 JPG·WebP로 변환합니다.' : '기기 안에서 JPG로 변환합니다. (이 브라우저는 WebP 저장을 지원하지 않습니다.)');
    }

    root.setAttribute('data-sc-ready', '1');
  }

  /* ------------------------------------------------------------------
   * 4. 공개 API
   * ------------------------------------------------------------------ */
  SalimCalc.PhotoCompress = {
    version: VERSION,
    config: CONFIG,
    init: init,
    calculate: calculate,
    summarize: summarize,
    planResize: planResize,
    parseTargetBytes: parseTargetBytes,
    pickOutputType: pickOutputType,
    formatBytes: formatBytes,
    outputFileName: outputFileName
  };
})(typeof window !== 'undefined' ? window : this);
