/*
 * 모듈: SalimCalc.photoResize / 사진 픽셀 변경·비율 자르기
 * 법령·고시: 해당 없음. 프리셋과 처리 한도는 서비스 자체 설정입니다.
 * 기술 근거: HTML Canvas 2D drawImage / toBlob
 * https://html.spec.whatwg.org/multipage/canvas.html
 * 기준일: 2026-10-05 / 버전: 1.0.0 / 최종수정일: 2026-10-05
 */
(function (window, document) {
  'use strict';

  var CONFIG = {
    maxFileBytes: 20 * 1024 * 1024,
    maxSourceSide: 12000,
    maxSourcePixels: 24000000,
    maxOutputSide: 4096,
    maxOutputPixels: 8000000,
    previewSide: 720,
    jpegQuality: 0.9,
    ratios: {
      '1:1': 1,
      '4:3': 4 / 3,
      '3:4': 3 / 4,
      '16:9': 16 / 9,
      '9:16': 9 / 16
    },
    presets: {
      custom: { label: '직접 설정' },
      blog: {
        label: '블로그 본문 · 가로 1,200px',
        width: 1200
      },
      document: {
        label: '문서 첨부 · 가로 800px',
        width: 800
      },
      square: {
        label: '정사각 썸네일 · 600 × 600px',
        width: 600,
        ratio: '1:1'
      }
    }
  };

  function integer(value, label, max) {
    var s = String(value == null ? '' : value).trim();

    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s)) {
      throw new Error(label + '에 양의 정수를 입력해 주세요.');
    }

    var n = Number(s.replace(/,/g, ''));

    if (!isFinite(n) || n < 1 || n > max) {
      throw new Error(
        label + '은 1~' + format(max) + ' 범위로 입력해 주세요.'
      );
    }

    return n;
  }

  function format(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function position(value) {
    if (
      value !== '0' && value !== '0.5' && value !== '1' &&
      value !== 0 && value !== 0.5 && value !== 1
    ) {
      throw new Error('자르기 위치를 다시 선택해 주세요.');
    }
    return Number(value);
  }

  // DOM·이미지 객체를 참조하지 않는 순수 계산 함수입니다.
  function calculate(input) {
    var sw = integer(
      input.sourceWidth, '원본 가로', CONFIG.maxSourceSide
    );
    var sh = integer(
      input.sourceHeight, '원본 세로', CONFIG.maxSourceSide
    );

    if (sw * sh > CONFIG.maxSourcePixels) {
      throw new Error('원본은 2,400만 픽셀 이하만 지원합니다.');
    }

    if (input.mode !== 'resize' && input.mode !== 'crop') {
      throw new Error('작업 방식을 선택해 주세요.');
    }

    if (input.axis !== 'width' && input.axis !== 'height') {
      throw new Error('기준 방향을 확인해 주세요.');
    }

    var crop = input.mode === 'crop';
    var ratio = crop ? CONFIG.ratios[input.ratio] : sw / sh;

    if (typeof ratio !== 'number' || !isFinite(ratio)) {
      throw new Error('지원하는 비율을 선택해 주세요.');
    }

    var w, h;

    if (crop || input.keep === true) {
      if (input.axis === 'height') {
        h = integer(input.height, '세로', CONFIG.maxOutputSide);
        w = Math.round(h * ratio);
      } else {
        w = integer(input.width, '가로', CONFIG.maxOutputSide);
        h = Math.round(w / ratio);
      }
    } else {
      w = integer(input.width, '가로', CONFIG.maxOutputSide);
      h = integer(input.height, '세로', CONFIG.maxOutputSide);
    }

    integer(w, '결과 가로', CONFIG.maxOutputSide);
    integer(h, '결과 세로', CONFIG.maxOutputSide);

    if (w * h > CONFIG.maxOutputPixels) {
      throw new Error('결과는 800만 픽셀 이하로 설정해 주세요.');
    }

    var cw = sw, ch = sh, x = 0, y = 0;

    if (crop) {
      // 정수 반올림된 출력 비율에 맞추어 자르므로
      // 이미지가 늘어나지 않습니다.
      if (sw / sh > w / h) {
        cw = sh * w / h;
      } else {
        ch = sw * h / w;
      }

      x = (sw - cw) * position(input.x);
      y = (sh - ch) * position(input.y);
    }

    return {
      width: w,
      height: h,
      sourceWidth: sw,
      sourceHeight: sh,
      sx: x,
      sy: y,
      cropWidth: cw,
      cropHeight: ch,
      pixels: w * h,
      enlarged: w > cw || h > ch,
      distorted: !crop && input.keep !== true && sw * h !== sh * w,
      basis: crop
        ? '선택 비율로 원본 영역을 자른 뒤 지정 크기로 조절합니다.'
        : (
          input.keep === true
            ? '원본 비율로 반대쪽 길이를 계산하고 정수 픽셀로 반올림합니다.'
            : '가로와 세로를 각각 지정한 길이로 변경합니다.'
        )
    };
  }

  function init(selector) {
    var root = document.querySelector(selector);

    if (!root || root.getAttribute('data-ready')) {
      return;
    }

    function get(name) {
      return root.querySelector('[data-role="' + name + '"]');
    }

    var file = get('file');
    var settings = get('settings');
    var mode = get('mode');
    var keep = get('keep');
    var ratio = get('ratio');
    var preset = get('preset');
    var width = get('width');
    var height = get('height');
    var px = get('x');
    var py = get('y');
    var type = get('type');
    var run = get('run');
    var status = get('status');
    var canvas = get('canvas');
    var original = get('original');
    var result = get('result');
    var download = get('download');
    var fallback = get('fallback');
    var URLApi = window.URL || window.webkitURL;

    if (
      !URLApi || !URLApi.createObjectURL ||
      !canvas.getContext || !canvas.getContext('2d') ||
      !canvas.toBlob
    ) {
      fallback.textContent =
        '계산기를 불러오지 못했습니다. 최신 Chrome 또는 Safari에서 다시 열어 주세요.';
      return;
    }

    var img = null;
    var sourceURL = '';
    var outputURL = '';
    var revision = 0;
    var loadId = 0;
    var axis = 'width';
    var name = 'photo';

    function options(select, items) {
      Object.keys(items).forEach(function (key) {
        var option = document.createElement('option');
        option.value = key;
        option.textContent = items[key].label || key;
        select.appendChild(option);
      });
    }

    options(preset, CONFIG.presets);
    options(ratio, CONFIG.ratios);

    function message(text) {
      status.textContent = text;
    }

    function clearOutput() {
      revision += 1;
      download.hidden = true;
      download.removeAttribute('href');

      if (outputURL) {
        URLApi.revokeObjectURL(outputURL);
        outputURL = '';
      }

      result.textContent = '';
      canvas.hidden = true;
      canvas.width = canvas.height = 1;
      run.disabled = !img;
    }

    function input() {
      return {
        sourceWidth: img.naturalWidth,
        sourceHeight: img.naturalHeight,
        mode: mode.value,
        keep: keep.checked,
        ratio: ratio.value,
        axis: axis,
        width: width.value,
        height: height.value,
        x: px.value,
        y: py.value
      };
    }

    function sync() {
      keep.disabled = mode.value === 'crop';
      get('cropOptions').hidden = mode.value !== 'crop';

      if (!img) {
        return;
      }

      try {
        var r = calculate(input());
        width.value = format(r.width);
        height.value = format(r.height);
        message('설정을 적용하려면 미리보기 만들기를 눌러 주세요.');
      } catch (e) {
        message(e.message);
      }
    }

    function formatField(el) {
      var value = el.value;

      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) {
        return;
      }

      var caret = el.selectionStart;
      var digits = value.slice(0, caret).replace(/,/g, '').length;

      el.value = value.replace(/,/g, '')
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      if (caret !== null) {
        var i = 0;
        var seen = 0;

        while (i < el.value.length && seen < digits) {
          if (el.value.charAt(i) !== ',') {
            seen += 1;
          }
          i += 1;
        }

        el.setSelectionRange(i, i);
      }
    }

    [width, height].forEach(function (el) {
      el.addEventListener('input', function () {
        axis = el === width ? 'width' : 'height';
        preset.value = 'custom';
        clearOutput();
        formatField(el);

        if (!img) {
          return;
        }

        try {
          var r = calculate(input());

          if (mode.value === 'crop' || keep.checked) {
            (el === width ? height : width).value =
              format(el === width ? r.height : r.width);
          }

          message('크기를 변경했습니다. 미리보기를 다시 만들어 주세요.');
        } catch (e) {
          message(e.message);
        }
      });
    });

    [mode, keep, ratio, px, py, type].forEach(function (el) {
      el.addEventListener('change', function () {
        preset.value = 'custom';
        clearOutput();
        sync();
      });
    });

    preset.addEventListener('change', function () {
      var p = CONFIG.presets[preset.value];
      clearOutput();

      if (p && p.width) {
        width.value = format(p.width);
        axis = 'width';
        keep.checked = true;
        mode.value = p.ratio ? 'crop' : 'resize';

        if (p.ratio) {
          ratio.value = p.ratio;
        }

        px.value = py.value = '0.5';
      }

      sync();
    });

    file.addEventListener('change', function () {
      var token = ++loadId;
      var selected = file.files && file.files[0];

      img = null;
      clearOutput();
      settings.disabled = true;
      original.hidden = true;
      original.width = original.height = 1;

      if (sourceURL) {
        URLApi.revokeObjectURL(sourceURL);
        sourceURL = '';
      }

      if (!selected) {
        message('사진을 선택해 주세요.');
        return;
      }

      var supported = selected.type
        ? /^image\/(jpeg|png|webp)$/i.test(selected.type)
        : /\.(jpe?g|png|webp)$/i.test(selected.name);

      if (!supported) {
        message(
          'JPG, PNG, WebP 파일만 지원합니다. HEIC와 GIF는 먼저 변환해 주세요.'
        );
        return;
      }

      if (!selected.size || selected.size > CONFIG.maxFileBytes) {
        message(
          '0바이트 파일은 사용할 수 없으며 최대 20MiB까지 지원합니다.'
        );
        return;
      }

      message('사진을 읽고 있습니다.');

      var next = new window.Image();

      function release() {
        if (sourceURL) {
          URLApi.revokeObjectURL(sourceURL);
          sourceURL = '';
        }
      }

      next.onload = function () {
        if (token !== loadId) {
          return;
        }

        release();

        try {
          var sw = next.naturalWidth;
          var sh = next.naturalHeight;
          var factor = Math.min(
            1, CONFIG.previewSide / Math.max(sw, sh)
          );

          calculate({
            sourceWidth: sw,
            sourceHeight: sh,
            mode: 'resize',
            keep: true,
            axis: 'width',
            width: Math.max(1, Math.round(sw * factor))
          });

          original.width = Math.max(1, Math.round(sw * factor));
          original.height = Math.max(1, Math.round(sh * factor));
          original.getContext('2d').drawImage(
            next, 0, 0, original.width, original.height
          );

          img = next;
          original.hidden = false;
          settings.disabled = false;

          name = selected.name
            .replace(/\.[^.]+$/, '')
            .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
            .slice(0, 60) || 'photo';

          mode.value = 'resize';
          keep.checked = true;
          preset.value = 'custom';
          axis = 'width';

          width.value = format(
            Math.min(sw, CONFIG.presets.blog.width)
          );

          // 세로로 긴 사진도 출력 한도를 넘지 않도록 초기값을 제한합니다.
          if (
            Math.round(
              Number(width.value.replace(/,/g, '')) * sh / sw
            ) > CONFIG.maxOutputSide
          ) {
            axis = 'height';
            height.value = format(CONFIG.presets.blog.width);
          }

          sync();
          run.disabled = false;

          message(
            '원본 ' + format(sw) + ' × ' + format(sh) +
            'px. 방향을 확인하고 미리보기를 만들어 주세요.'
          );
        } catch (e) {
          img = null;
          settings.disabled = true;
          run.disabled = true;
          original.hidden = true;
          message(e.message);
        }
      };

      next.onerror = function () {
        if (token !== loadId) {
          return;
        }

        release();
        message(
          '사진을 읽지 못했습니다. 손상 여부와 지원 형식을 확인해 주세요.'
        );
      };

      try {
        sourceURL = URLApi.createObjectURL(selected);
        next.src = sourceURL;
      } catch (e) {
        release();
        message('파일을 열지 못했습니다. 다시 선택해 주세요.');
      }
    });

    function row(label, value, strong) {
      var li = document.createElement('li');
      var text = document.createElement(strong ? 'strong' : 'span');

      text.textContent = label + ': ' + value;
      li.appendChild(text);
      result.appendChild(li);
    }

    run.addEventListener('click', function () {
      clearOutput();

      if (!img) {
        message('사진을 먼저 선택해 주세요.');
        return;
      }

      try {
        var r = calculate(input());
        var mime = type.value;

        if (mime !== 'image/jpeg' && mime !== 'image/png') {
          throw new Error('저장 형식을 다시 선택해 주세요.');
        }

        var ticket = revision;

        canvas.width = r.width;
        canvas.height = r.height;

        var ctx = canvas.getContext('2d');

        if (!ctx) {
          throw new Error(
            '이미지를 처리할 메모리가 부족합니다. 크기를 줄여 주세요.'
          );
        }

        if (mime === 'image/jpeg') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, r.width, r.height);
        }

        ctx.imageSmoothingEnabled = true;

        if ('imageSmoothingQuality' in ctx) {
          ctx.imageSmoothingQuality = 'high';
        }

        ctx.drawImage(
          img,
          r.sx,
          r.sy,
          r.cropWidth,
          r.cropHeight,
          0,
          0,
          r.width,
          r.height
        );

        run.disabled = true;
        message('저장 파일을 만들고 있습니다.');

        canvas.toBlob(function (blob) {
          if (ticket !== revision) {
            return;
          }

          run.disabled = false;

          if (!blob || !blob.size) {
            clearOutput();
            message(
              '저장 파일 생성에 실패했습니다. 크기를 줄여 다시 시도해 주세요.'
            );
            return;
          }

          try {
            if (blob.type !== mime) {
              throw new Error(
                '선택한 저장 형식을 지원하지 않는 브라우저입니다.'
              );
            }

            outputURL = URLApi.createObjectURL(blob);
            download.href = outputURL;
            download.download =
              name + '-' + r.width + 'x' + r.height +
              (mime === 'image/png' ? '.png' : '.jpg');

            download.hidden = false;
            canvas.hidden = false;

            row(
              '원본',
              format(r.sourceWidth) + ' × ' +
              format(r.sourceHeight) + 'px'
            );

            row(
              '최종 크기',
              format(r.width) + ' × ' + format(r.height) + 'px',
              true
            );

            row('총 픽셀 수', format(r.pixels) + '개', true);

            row(
              '저장 파일 용량',
              format(blob.size) + '바이트 (약 ' +
              (blob.size / 1024).toFixed(1) + 'KiB)'
            );

            row('적용 근거', r.basis);

            if (r.enlarged) {
              row(
                '확대 안내',
                '원본 영역보다 확대되었습니다. 선명도가 좋아지는 것은 아닙니다.'
              );
            }

            if (r.distorted) {
              row(
                '비율 안내',
                '원본과 비율이 달라 피사체가 늘어나거나 눌릴 수 있습니다.'
              );
            }

            message(
              '완료했습니다. 결과와 파일 용량을 확인한 뒤 저장해 주세요.'
            );
          } catch (e) {
            clearOutput();
            message(e.message);
          }
        }, mime, CONFIG.jpegQuality);
      } catch (e) {
        clearOutput();
        message(e.message || '처리하지 못했습니다. 크기를 줄여 주세요.');
      }
    });

    root.setAttribute('data-ready', 'true');
    get('controls').hidden = false;
    fallback.hidden = true;

    message(
      '사진을 선택해 주세요. 선택한 파일은 이 도구의 서버로 전송하지 않습니다.'
    );
  }

  window.SalimCalc = window.SalimCalc || {};
  window.SalimCalc.photoResize = {
    init: init,
    calculate: calculate
  };
}(window, document));