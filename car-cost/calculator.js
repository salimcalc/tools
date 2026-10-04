/*!
 * 살림계산 · 자동차 유지비 계산기
 * https://github.com/salimcalc/tools
 * 계산은 방문자의 브라우저에서만 실행되며 입력값을 어디에도 전송·저장하지 않습니다.
 *
 * 세율 기준(작성 기준일 2026-10-05)
 *  - 비영업용 승용차 자동차세: 1,000cc 이하 80원, 1,600cc 이하 140원, 1,600cc 초과 200원 (cc당)
 *  - 지방교육세: 자동차세의 30%
 *  - 차령 경감: 3년차부터 매년 5%, 최대 50%
 *  - 1월 연납 공제: 자동차세 본세 × 5% × (2월 1일~12월 31일 일수 / 해당 연도 일수)
 *  - 전기·수소차 등 그 밖의 승용차: 연 100,000원 + 지방교육세 30% (차령 경감 미반영)
 */
(function (root) {
  'use strict';

  var TAX = {
    rates: [
      { maxCc: 1000, perCc: 80 },
      { maxCc: 1600, perCc: 140 },
      { maxCc: Infinity, perCc: 200 }
    ],
    eduRate: 0.3,
    ageStartYear: 3,
    agePerYear: 0.05,
    ageMax: 0.5,
    prepayRate: 0.05,
    evAnnual: 100000
  };

  var FUELS = {
    gasoline: { label: '휘발유', unit: 'L', defaultPrice: 1857.6 },
    diesel: { label: '경유', unit: 'L', defaultPrice: 1843.3 },
    lpg: { label: 'LPG', unit: 'L', defaultPrice: null },
    ev: { label: '전기', unit: 'kWh', defaultPrice: null }
  };

  var LIMITS = {
    km: [1, 200000],
    eff: [0.5, 100],
    price: [1, 10000],
    cc: [50, 10000],
    money: [0, 100000000]
  };

  function floor10(n) { return Math.floor(n / 10) * 10; }

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  /** 차령(연식 기준 단순 계산): 과세연도 - 최초등록연도 + 1 */
  function carAge(regYear, taxYear) { return taxYear - regYear + 1; }

  /** 차령 경감률 (0 ~ 0.5) */
  function ageReduction(age) {
    if (age < TAX.ageStartYear) return 0;
    var pct = Math.min((age - TAX.ageStartYear + 1) * TAX.agePerYear * 100, TAX.ageMax * 100);
    return Math.round(pct) / 100;
  }

  /** 1월 연납 실질 공제 비율 (예: 2026년 = 5% × 334/365 ≈ 4.575%) */
  function prepayFactor(taxYear) {
    var daysInYear = isLeap(taxYear) ? 366 : 365;
    var daysFromFeb = daysInYear - 31; // 2월 1일 ~ 12월 31일
    return TAX.prepayRate * daysFromFeb / daysInYear;
  }

  /**
   * 자동차세 계산
   * @param {{type:'cc'|'ev', cc?:number, regYear?:number, taxYear:number, prepay:boolean}} o
   */
  function calcCarTax(o) {
    var base, reduction = 0, age = null, perCc = null;
    if (o.type === 'ev') {
      base = TAX.evAnnual;
    } else {
      for (var i = 0; i < TAX.rates.length; i++) {
        if (o.cc <= TAX.rates[i].maxCc) { perCc = TAX.rates[i].perCc; break; }
      }
      age = carAge(o.regYear, o.taxYear);
      reduction = ageReduction(age);
      base = o.cc * perCc * Math.round((1 - reduction) * 100) / 100;
    }
    var mainTax = floor10(base);
    var eduTax = floor10(mainTax * TAX.eduRate);
    var prepayDiscount = o.prepay ? floor10(mainTax * prepayFactor(o.taxYear)) : 0;
    return {
      perCc: perCc,
      age: age,
      reduction: reduction,
      mainTax: mainTax,
      eduTax: eduTax,
      prepayDiscount: prepayDiscount,
      total: mainTax + eduTax - prepayDiscount
    };
  }

  /** 연간 연료비 = 주행거리 ÷ 연비 × 단가 (원 단위 반올림) */
  function calcFuel(km, eff, price) { return Math.round(km / eff * price); }

  /**
   * 전체 유지비 계산 (모든 금액은 원 단위 정수)
   */
  function calcAll(inp) {
    var fuel = calcFuel(inp.km, inp.eff, inp.price);
    var tax = inp.taxMode === 'manual'
      ? { total: Math.round(inp.taxManual), manual: true }
      : calcCarTax({ type: inp.fuelType === 'ev' ? 'ev' : 'cc', cc: inp.cc, regYear: inp.regYear, taxYear: inp.taxYear, prepay: inp.prepay });
    var items = [
      { key: 'fuel', label: '연료·충전비', annual: fuel },
      { key: 'tax', label: '자동차세(지방교육세 포함)', annual: tax.total },
      { key: 'insurance', label: '자동차보험료', annual: Math.round(inp.insurance) },
      { key: 'maint', label: '정비·소모품', annual: Math.round(inp.maint) },
      { key: 'parking', label: '주차비', annual: Math.round(inp.parkingMonthly) * 12 },
      { key: 'toll', label: '통행료', annual: Math.round(inp.tollMonthly) * 12 },
      { key: 'etc', label: '기타(세차·검사 등)', annual: Math.round(inp.etc) },
      { key: 'loan', label: '할부금·리스료', annual: Math.round(inp.loanMonthly) * 12 }
    ];
    var total = items.reduce(function (s, it) { return s + it.annual; }, 0);
    var runningTotal = total - items[7].annual;
    return {
      items: items,
      tax: tax,
      total: total,
      monthly: Math.round(total / 12),
      perKm: Math.round(total / inp.km),
      runningTotal: runningTotal,
      runningMonthly: Math.round(runningTotal / 12)
    };
  }

  var api = { TAX: TAX, FUELS: FUELS, LIMITS: LIMITS, carAge: carAge, ageReduction: ageReduction, prepayFactor: prepayFactor, calcCarTax: calcCarTax, calcFuel: calcFuel, calcAll: calcAll };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.CarCost = api;

  /* ---------------- 화면 처리 ---------------- */
  if (typeof document === 'undefined') return;

  // iframe 높이 전달: 허용한 부모 출처에만 전송
  var PARENT_ORIGINS = ['https://salimcalc.blogspot.com'];

  var $ = function (id) { return document.getElementById(id); };
  var won = function (n) { return n.toLocaleString('ko-KR') + '원'; };

  function parseNum(el) {
    var v = String(el.value).replace(/,/g, '').trim();
    if (v === '') return NaN;
    return Number(v);
  }

  function setError(id, msg) {
    var el = $(id), err = $(id + '-err');
    if (!el || !err) return;
    err.textContent = msg || '';
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  }

  function check(id, range, label, opts) {
    opts = opts || {};
    var fmt = function (v) { return opts.plain ? String(v) : v.toLocaleString('ko-KR'); };
    var n = parseNum($(id));
    if (isNaN(n)) {
      if (opts.allowEmpty) { setError(id, ''); return 0; }
      setError(id, label + ': 값을 입력해 주세요.'); return null;
    }
    if (opts.integer && Math.floor(n) !== n) { setError(id, label + ': 소수점 없이 정수로 입력해 주세요.'); return null; }
    if (n < range[0]) { setError(id, label + ': ' + fmt(range[0]) + ' 이상으로 입력해 주세요.'); return null; }
    if (n > range[1]) { setError(id, label + ': 값이 너무 큽니다. ' + fmt(range[1]) + ' 이하로 입력해 주세요.'); return null; }
    setError(id, '');
    return n;
  }

  function updateFuelUI() {
    var f = FUELS[$('fuelType').value];
    $('effUnit').textContent = 'km/' + f.unit;
    $('priceUnit').textContent = '원/' + f.unit;
    $('effLabel').textContent = f.unit === 'kWh' ? '전비' : '연비';
    var priceEl = $('price');
    priceEl.value = f.defaultPrice != null ? f.defaultPrice : '';
    $('priceHint').textContent = f.defaultPrice != null
      ? '기본값: 2026년 9월 다섯째 주 전국 평균(오피넷). 내 지역 가격으로 바꿔도 됩니다.'
      : '이 연료는 기본값이 없습니다. 오피넷·충전 요금표에서 확인한 단가를 입력하세요.';
    var isEv = $('fuelType').value === 'ev';
    $('ccRow').hidden = isEv;
    $('evNote').hidden = !isEv;
    setError('price', '');
  }

  function updateTaxModeUI() {
    var manual = $('taxMode').value === 'manual';
    $('taxAuto').hidden = manual;
    $('taxManualRow').hidden = !manual;
  }

  function render(r, inp) {
    var rows = r.items.map(function (it) {
      var pct = r.total > 0 ? (it.annual / r.total * 100) : 0;
      return '<tr><th scope="row">' + it.label + '</th><td>' + won(it.annual) + '</td><td>' + won(Math.round(it.annual / 12)) + '</td>' +
        '<td><span class="bar" style="width:' + pct.toFixed(1) + '%"></span><span class="pct">' + pct.toFixed(1) + '%</span></td></tr>';
    }).join('');
    var taxNote = '';
    if (r.tax.manual) {
      taxNote = '자동차세는 직접 입력한 금액을 사용했습니다.';
    } else if (inp.fuelType === 'ev') {
      taxNote = '자동차세: 전기차 등 그 밖의 승용차 기준 본세 ' + won(r.tax.mainTax) + ' + 지방교육세 ' + won(r.tax.eduTax) +
        (r.tax.prepayDiscount ? ' − 1월 연납 공제 ' + won(r.tax.prepayDiscount) : '') + ' (차령 경감 미반영).';
    } else {
      taxNote = '자동차세: ' + inp.cc.toLocaleString('ko-KR') + 'cc × ' + r.tax.perCc + '원, 차령 ' + r.tax.age + '년차 경감 ' + Math.round(r.tax.reduction * 100) + '% → 본세 ' +
        won(r.tax.mainTax) + ' + 지방교육세 ' + won(r.tax.eduTax) + (r.tax.prepayDiscount ? ' − 1월 연납 공제 ' + won(r.tax.prepayDiscount) : '') + '.';
    }
    $('result').innerHTML =
      '<h2 class="res-title">계산 결과</h2>' +
      '<div class="summary">' +
      '<div class="card"><span>연간 총 유지비</span><strong>' + won(r.total) + '</strong></div>' +
      '<div class="card"><span>월평균</span><strong>' + won(r.monthly) + '</strong></div>' +
      '<div class="card"><span>1km당</span><strong>' + won(r.perKm) + '</strong></div>' +
      '</div>' +
      (r.items[7].annual > 0 ? '<p class="sub">할부금·리스료를 뺀 순수 운행 유지비: 연 ' + won(r.runningTotal) + ' (월 ' + won(r.runningMonthly) + ')</p>' : '') +
      '<div class="table-wrap"><table><caption>항목별 연간·월 비용</caption><thead><tr><th scope="col">항목</th><th scope="col">연간</th><th scope="col">월평균</th><th scope="col">비중</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<ul class="notes"><li>연료비 = ' + inp.km.toLocaleString('ko-KR') + 'km ÷ ' + inp.eff + 'km/' + FUELS[inp.fuelType].unit + ' × ' + inp.price.toLocaleString('ko-KR') + '원 (원 단위 반올림)</li>' +
      '<li>' + taxNote + ' 10원 미만 절사, 실제 고지액과 차이가 날 수 있습니다.</li>' +
      '<li>보험료·정비비·주차비 등은 입력한 값을 그대로 합산했습니다. 감가상각과 취득세는 포함하지 않습니다.</li></ul>';
    $('result').hidden = false;
    $('status').textContent = '계산 완료. 연간 총 유지비 ' + won(r.total) + ', 월평균 ' + won(r.monthly) + '.';
    postHeight();
  }

  function onSubmit(e) {
    e.preventDefault();
    var fuelType = $('fuelType').value;
    var taxMode = $('taxMode').value;
    var thisYear = Number($('taxYear').value);
    var inp = {
      fuelType: fuelType,
      km: check('km', LIMITS.km, '연간 주행거리'),
      eff: check('eff', LIMITS.eff, fuelType === 'ev' ? '전비' : '연비'),
      price: check('price', LIMITS.price, '연료 단가'),
      taxMode: taxMode,
      taxYear: thisYear,
      prepay: $('prepay').checked,
      insurance: check('insurance', LIMITS.money, '연간 보험료', { allowEmpty: true }),
      maint: check('maint', LIMITS.money, '정비·소모품 비용', { allowEmpty: true }),
      parkingMonthly: check('parking', LIMITS.money, '월 주차비', { allowEmpty: true }),
      tollMonthly: check('toll', LIMITS.money, '월 통행료', { allowEmpty: true }),
      etc: check('etc', LIMITS.money, '기타 비용', { allowEmpty: true }),
      loanMonthly: check('loan', LIMITS.money, '월 할부금', { allowEmpty: true })
    };
    if (taxMode === 'manual') {
      inp.taxManual = check('taxManual', LIMITS.money, '자동차세');
      setError('cc', ''); setError('regYear', '');
    } else {
      setError('taxManual', '');
      if (fuelType !== 'ev') {
        inp.cc = check('cc', LIMITS.cc, '배기량', { integer: true });
        inp.regYear = check('regYear', [1950, thisYear], '최초 등록연도', { integer: true, plain: true });
      } else {
        setError('cc', ''); setError('regYear', '');
        inp.regYear = thisYear;
      }
    }
    var bad = Object.keys(inp).filter(function (k) { return inp[k] === null; });
    if (bad.length) {
      var first = document.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      $('status').textContent = '입력값을 확인해 주세요. 빨간 안내 문구가 있는 항목을 고쳐야 합니다.';
      postHeight();
      return;
    }
    render(calcAll(inp), inp);
  }

  function postHeight() {
    if (window.parent === window) return;
    var h = Math.ceil(document.documentElement.scrollHeight);
    PARENT_ORIGINS.forEach(function (o) {
      try { window.parent.postMessage({ type: 'salimcalc:height', id: 'car-cost', height: h }, o); } catch (e) { /* 무시 */ }
    });
  }

  function init() {
    var y = new Date().getFullYear();
    $('taxYear').value = y;
    $('taxYearText').textContent = y;
    $('regYear').max = y;
    $('fuelType').addEventListener('change', updateFuelUI);
    $('taxMode').addEventListener('change', function () { updateTaxModeUI(); postHeight(); });
    $('form').addEventListener('submit', onSubmit);
    $('form').addEventListener('reset', function () {
      setTimeout(function () {
        updateFuelUI(); updateTaxModeUI();
        document.querySelectorAll('.err').forEach(function (e) { e.textContent = ''; });
        document.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); });
        $('result').hidden = true; $('status').textContent = ''; postHeight();
      }, 0);
    });
    updateFuelUI(); updateTaxModeUI();
    window.addEventListener('resize', postHeight);
    postHeight();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : this);
